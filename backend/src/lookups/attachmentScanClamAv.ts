// Echte Virenscan-Anbindung (WEB_INBOX.md 21.09. "WICHTIGE LUECKE ENTDECKT -
// echter Malware-Scan"). Ersetzt attachmentScanMock.ts als produktiv
// verdrahtete Implementierung (siehe lookups/index.ts) -- die bestaetigte
// Anbieter-Entscheidung war ClamAV (kostenlos, quelloffen, selbst hostbar),
// angebunden ueber einen lokalen clamd-Daemon per Unix-Socket/TCP (siehe
// backend/README.md "Malware-Scan" fuer das lokale Setup).
//
// Drei Ebenen, wie im Auftrag verlangt:
// 1) Dateiendungs-Blockliste (uebernommen aus attachmentScanMock.ts --
//    ausfuehrbare/Makro-faehige Typen werden unabhaengig vom Inhalt
//    geblockt, gleiches Prinzip wie bei Gmail selbst).
// 2) Magic-Bytes-Pruefung (magicBytes.ts) -- erkennt eine als harmlos
//    getarnte, aber tatsaechlich ausfuehrbare Datei.
// 3) Echter ClamAV-Signaturabgleich ueber den laufenden clamd-Daemon.
//
// Ist clamd nicht erreichbar (Verbindung schlaegt fehl), wird NICHT
// stillschweigend auf "clean" zurueckgefallen -- das waere bei einem
// Sicherheits-Scanner grob irrefuehrend (anders als z.B. der KI-Adapter,
// wo ein Fallback auf eine schwaechere Heuristik vertretbar ist). Stattdessen
// liefert diese Implementierung den dafuer im Contract bereits vorgesehenen
// Wert `scan_failed` -- POST /messages/send lehnt das (wie jeden
// Nicht-"clean"-Status) mit 422 ab, eingehende Anhaenge mit scan_failed
// werden wie malicious behandelt (siehe mail/attachmentSync.ts).

import NodeClam from "clamscan";
import { Readable } from "node:stream";
import type { AttachmentScanner, AttachmentScanResult } from "./types";
import { isDisguisedExecutable } from "./magicBytes";

// Identisch zu attachmentScanMock.ts -- siehe dortigen Kommentar.
const DANGEROUS_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "js", "jse", "vbs", "vbe",
  "ws", "wsf", "ps1", "jar", "docm", "xlsm", "pptm", "dotm", "xltm",
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

// Lazy + einmalig initialisiert (nicht bei jedem Scan neu verbinden) --
// gleiches Prinzip wie der einmalig aufgebaute Pool in db/postgresStore.ts.
let clamscanPromise: Promise<NodeClam> | null = null;

function getClamscan(): Promise<NodeClam> {
  if (!clamscanPromise) {
    clamscanPromise = new NodeClam().init({
      clamdscan: {
        // Lokaler Unix-Socket ist der Standardweg (siehe backend/README.md
        // "Malware-Scan" fuer das lokale clamd-Setup) -- CLAMAV_HOST/
        // CLAMAV_PORT erlauben stattdessen TCP (z.B. ein Sidecar-Container
        // in Produktion, in dem kein gemeinsamer Unix-Socket-Pfad existiert).
        socket: process.env.CLAMAV_HOST ? false : process.env.CLAMAV_SOCKET || "/tmp/clamd.sock",
        host: process.env.CLAMAV_HOST || false,
        port: process.env.CLAMAV_PORT ? Number(process.env.CLAMAV_PORT) : false,
        timeout: 60_000,
        // Kein Rueckfall auf einen lokalen clamscan-Binary-Aufruf -- ein
        // fehlgeschlagener Socket-Connect soll ehrlich als scan_failed
        // durchschlagen (siehe Datei-Kommentar oben), nicht stillschweigend
        // einen anderen Scan-Pfad nehmen.
        localFallback: false,
      },
      clamscan: { active: false },
      preference: "clamdscan",
    });
  }
  return clamscanPromise;
}

export class ClamAvAttachmentScanner implements AttachmentScanner {
  async scan(input: { filename: string; mimeType: string | null; sizeBytes: number; buffer: Buffer }): Promise<AttachmentScanResult> {
    if (DANGEROUS_EXTENSIONS.has(extensionOf(input.filename))) {
      return { scanStatus: "blocked_type", isDangerousType: true };
    }
    if (isDisguisedExecutable(input.filename, input.buffer)) {
      return { scanStatus: "blocked_type", isDangerousType: true };
    }

    try {
      const clamscan = await getClamscan();
      const { isInfected } = await clamscan.scanStream(Readable.from(input.buffer));
      return isInfected
        ? { scanStatus: "malicious", isDangerousType: true }
        : { scanStatus: "clean", isDangerousType: false };
    } catch (err) {
      console.error(`[attachments] ClamAV-Scan fuer "${input.filename}" fehlgeschlagen:`, err);
      return { scanStatus: "scan_failed", isDangerousType: false };
    }
  }
}
