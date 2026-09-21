// Scan eingehender Mail-Anhaenge beim Sync (WEB_INBOX.md 21.09. "WICHTIGE
// LUECKE ENTDECKT - echter Malware-Scan", Punkt 2 "NEU (Empfangen)").
// Vorher: es gab fuer eingehende Anhaenge ueberhaupt keinen Scan -- eine
// Mail mit boesartigem Anhang landete ungeprueft im Postfach. Laeuft mit
// demselben Scanner wie beim Senden (attachmentScanner, siehe
// lookups/index.ts), damit beide Richtungen exakt dieselbe Pruefung
// durchlaufen (Dateiendungs-Blockliste + Magic-Bytes + ClamAV).
//
// Bewusst KEIN Auto-Loeschen bei einem als malicious erkannten Anhang --
// anders als beim spam/gambling-Auto-Delete-Pfad in sync.ts. Ein infizierter
// Anhang koennte von einem legitimen Absender stammen (siehe
// backend/README.md "Malware-Scan"), der User soll die Mail selbst noch
// sehen koennen. Nur der Anhang selbst bleibt gesperrt (scanStatus !=
// 'clean' in der API-Antwort, Client darf ihn dann nicht zum Oeffnen
// anbieten, siehe api-spec.yaml MessageDetail.attachments).

import { attachmentScanner } from "../lookups";
import { store } from "../db/store";
import type { FetchedAttachment } from "./types";

export async function scanAndStoreIncomingAttachments(messageId: string, attachments: FetchedAttachment[]): Promise<void> {
  for (const attachment of attachments) {
    const { scanStatus, isDangerousType } = await attachmentScanner.scan({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.content.length,
      buffer: attachment.content,
    });
    await store.insertAttachment({
      messageId,
      uploadedByUserId: null,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.content.length,
      scanStatus,
      isDangerousType,
      scannedAt: new Date().toISOString(),
      // Sensible-Dokument-Erkennung (OCR) ist bewusst nur fuer beim SENDEN
      // hochgeladene Anhaenge verdrahtet (routes/attachments.ts) -- ein
      // eingehender Anhang ist fuer den Empfaenger keine eigene sensible
      // Preisgabe, die Erkennung war urspruenglich fuer die Warnung VOR dem
      // eigenen Versand gedacht. Kein Umfang dieses Auftrags.
      containsSensitiveDocument: "none",
    });
  }
}
