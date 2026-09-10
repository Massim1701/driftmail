import { Router } from "express";
import multer from "multer";
import { store, ensureDemoUser } from "../db/store";
import { attachmentScanner } from "../lookups";

export const attachmentsRouter = Router();

// Reine In-Memory-Zwischenspeicherung des Datei-Uploads für multer (kein
// eigener Multer-Diskspeicher) -- der Inhalt selbst wird NICHT dauerhaft
// gespeichert, siehe Kommentar an der Route unten. 15 MB Limit als
// willkürliche, aber plausible Beispielgrenze (kein Wert aus dem Contract).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// POST /attachments — siehe api-spec.yaml (WEB_INBOX.md 09.09. "Erweiterung
// des Send-Endpunkt-Eintrags von eben"). Lädt eine Datei hoch und scannt sie
// SOFORT (message_id ist hier noch null, uploaded_by_user_id gesetzt) --
// erst nach scan_status='clean' darf die attachmentId bei POST /messages/send
// mitgegeben werden (siehe dortige Prüfung).
//
// Grenze (bewusst, nicht Teil dieses Schritts): der Dateiinhalt selbst wird
// NICHT gespeichert (weder im Store noch sonstwo) -- message_attachments hat
// laut Contract keine content-Spalte (eine echte Implementierung würde
// Objektspeicher wie S3 nutzen, kein DB-Feld). Der Scan hier läuft deshalb
// nur gegen Metadaten (Dateiname/MIME-Typ/Größe), nicht gegen den
// tatsächlichen Byte-Inhalt -- siehe attachmentScanMock.ts. Eine Folge
// davon: POST /messages/send bettet die Anhänge aktuell NICHT tatsächlich
// in die ausgehende Mail ein (kein Objektspeicher vorhanden, aus dem die
// Bytes beim Versand wieder gelesen werden könnten) -- der Endpunkt prüft
// nur, dass alle mitgegebenen attachmentIds scan_status='clean' haben.
// Echte Speicherung + Einbettung in die ausgehende Mail ist ein späterer
// Schritt, siehe backend/README.md "Anhänge".
attachmentsRouter.post("/attachments", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "keine Datei im Feld 'file' gefunden" });
  }

  const { scanStatus, isDangerousType } = await attachmentScanner.scan({
    filename: file.originalname,
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
  });

  const { user } = await ensureDemoUser();
  const record = await store.insertAttachment({
    messageId: null,
    uploadedByUserId: user.id,
    filename: file.originalname,
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
    scanStatus,
    isDangerousType,
    scannedAt: new Date().toISOString(),
  });

  res.status(200).json({ attachmentId: record.id, scanStatus: record.scanStatus });
});
