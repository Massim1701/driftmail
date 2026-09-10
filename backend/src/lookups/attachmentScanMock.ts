// Mock-Implementierung von AttachmentScanner (siehe types.ts).
//
// WEB_INBOX.md 09.09. ("Erweiterung des Send-Endpunkt-Eintrags"): "fuer den
// ersten Durchstich reicht eine einfache Dateityp-/Endungspruefung ...
// echte Scan-Anbindung ist ein spaeterer Schritt wie bei den externen
// Lookups" -- dieser Mock macht KEINEN echten Virenscan (kein ClamAV/
// VirusTotal-Aufruf), sondern prueft nur die Dateiendung gegen eine
// Beispielliste gefaehrlicher Typen, analog zu den TLD-/Keyword-Heuristiken
// in domainReputationMock.ts. `scan_failed` wird hier nie geliefert (kein
// echter Dienst, der fehlschlagen könnte) -- der Enum-Wert existiert im
// Contract für eine spätere echte Anbindung.

import type { AttachmentScanner, AttachmentScanResult } from "./types";

// Ausfuehrbare/Makro-faehige Dateitypen -- ueberwiegend das, was gaengige
// E-Mail-Provider selbst schon als Anhang blockieren (Gmail z.B. .exe/.bat/
// .js), plus Office-Makro-Formate (.docm/.xlsm/.pptm), ein haeufiger
// Infektionsweg per Mail-Anhang.
const DANGEROUS_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "js", "jse", "vbs", "vbe",
  "ws", "wsf", "ps1", "jar", "docm", "xlsm", "pptm", "dotm", "xltm",
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export class MockAttachmentScanner implements AttachmentScanner {
  async scan(input: { filename: string; mimeType: string | null; sizeBytes: number }): Promise<AttachmentScanResult> {
    // Deterministischer Test-Trigger fuer den "malicious"-Fall (analog zur
    // Botnetz-Beispiel-IP-Liste in ipReputationMock.ts) -- kein echter
    // Signatur-Abgleich, nur ein Name, der in Tests/Demos absichtlich
    // verwendet werden kann.
    if (/virus|malware/i.test(input.filename)) {
      return { scanStatus: "malicious", isDangerousType: true };
    }

    const extension = extensionOf(input.filename);
    if (DANGEROUS_EXTENSIONS.has(extension)) {
      return { scanStatus: "blocked_type", isDangerousType: true };
    }

    return { scanStatus: "clean", isDangerousType: false };
  }
}
