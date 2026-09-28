import { Router } from "express";
import multer from "multer";
import { ocrAdapter, scanForSensitiveDocument } from "../attachments";
import { encryptBytes } from "../auth/credentialsEncryption";
import { store } from "../db/store";
import { attachmentScanner } from "../lookups";

export const attachmentsRouter = Router();

// Reine In-Memory-Zwischenspeicherung des Datei-Uploads für multer (kein
// eigener Multer-Diskspeicher) -- der Inhalt selbst wird nur kurz und
// verschluesselt aufbewahrt, siehe Kommentar an der Route unten. 15 MB Limit als
// willkürliche, aber plausible Beispielgrenze (kein Wert aus dem Contract).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// POST /attachments — siehe api-spec.yaml (WEB_INBOX.md 09.09. "Erweiterung
// des Send-Endpunkt-Eintrags von eben"). Lädt eine Datei hoch und scannt sie
// SOFORT (message_id ist hier noch null, uploaded_by_user_id gesetzt) --
// erst nach scan_status='clean' darf die attachmentId bei POST /messages/send
// mitgegeben werden (siehe dortige Prüfung).
//
// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": der Scan
// laeuft jetzt echt gegen die tatsaechlichen Bytes (multer haelt den Upload
// ohnehin im Speicher, `file.buffer`), nicht mehr nur gegen Metadaten --
// siehe attachmentScanClamAv.ts.
//
// [2026-09-28] Anhaenge werden jetzt wirklich verschickt (Entscheidung
// Massimo, SYNC.md 28.09.): der Inhalt einer SAUBEREN Datei wird nach dem
// Scan verschluesselt (AES-256-GCM, siehe auth/credentialsEncryption.ts
// encryptBytes) in pending_attachment_content abgelegt -- nur bis zum
// Senden, hoechstens PENDING_ATTACHMENT_TTL_MS (24 h), danach loescht der
// Scheduler. Nicht-saubere Dateien werden nie aufbewahrt, sie duerfen ohnehin
// nicht verschickt werden. Kein dauerhafter Objektspeicher.
export const PENDING_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

attachmentsRouter.post("/attachments", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "keine Datei im Feld 'file' gefunden" });
  }

  const { scanStatus, isDangerousType } = await attachmentScanner.scan({
    filename: file.originalname,
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
    buffer: file.buffer,
  });

  // [2026-09-15] WEB_INBOX.md "Sensible-Daten-Erkennung um Fotos von
  // Ausweisen/Kreditkarten erweitern": Nachbearbeitungsschritt NACH dem
  // Malware-/Dateityp-Scan (gleiches Reihenfolge-Prinzip wie bei den
  // externen Lookups nach analyzeMail()). Nur für scanStatus='clean'
  // versucht -- ein bereits als gefährlich/blockiert eingestuftes Bild
  // bekommt ohnehin schon die dominante Warnung, ein zusätzlicher
  // OCR-Lauf darauf wäre verschwendete Arbeit ohne UI-Nutzen.
  const containsSensitiveDocument =
    scanStatus === "clean"
      ? await scanForSensitiveDocument({ buffer: file.buffer, mimeType: file.mimetype || null }, ocrAdapter)
      : "none";

  const record = await store.insertAttachment({
    messageId: null,
    uploadedByUserId: req.userId,
    filename: file.originalname,
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
    scanStatus,
    isDangerousType,
    scannedAt: new Date().toISOString(),
    containsSensitiveDocument,
  });

  if (record.scanStatus === "clean") {
    const expiresAt = new Date(Date.now() + PENDING_ATTACHMENT_TTL_MS).toISOString();
    await store.savePendingAttachmentContent(record.id, encryptBytes(file.buffer), expiresAt);
  }

  res.status(200).json({
    attachmentId: record.id,
    scanStatus: record.scanStatus,
    containsSensitiveDocument: record.containsSensitiveDocument,
  });
});
