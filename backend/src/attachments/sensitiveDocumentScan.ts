// Orchestriert die Sensible-Dokument-Erkennung für Bild-Anhänge
// (WEB_INBOX.md 15.09. "Sensible-Daten-Erkennung um Fotos von
// Ausweisen/Kreditkarten erweitern", Nachbearbeitungsschritt NACH dem
// bestehenden Malware-/Dateityp-Scan, siehe attachmentScanMock.ts +
// routes/attachments.ts): OCR -> bereits vorhandene Text-Pattern-Erkennung
// aus @driftmail/security-classification (Wiederverwendung statt Neubau,
// wie im Auftrag verlangt) -- kein eigenes Bilderkennungsmodell.
import { detectCreditCard, detectMrz } from "@driftmail/security-classification";
import type { SensitiveDocumentKind } from "../types";
import type { OcrAdapter } from "./types";

// jpg/png sind über tesseract.js direkt lesbar. heic (von der Spec
// ausdrücklich genannt) NICHT unterstützt -- bräuchte eine vorgeschaltete
// Konvertierung (z.B. libheif), bewusst nicht Teil dieses Schritts. Ein
// heic-Anhang bekommt deshalb ehrlich 'none' zurück (kein OCR-Versuch, kein
// geratenes Ergebnis) statt eines falschen "sicher, nichts gefunden".
const OCR_SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Priorität bei Treffer in beiden Kategorien (theoretisch möglich, z.B. ein
 * Foto mit Kreditkarte UND MRZ-Dokument im selben Bild): 'credit_card' vor
 * 'id_document' -- willkürliche, aber dokumentierte Entscheidung (Contract
 * erlaubt nur einen einzelnen Enum-Wert, kein Array), da keine der beiden
 * Kategorien objektiv "wichtiger" ist.
 */
export async function scanForSensitiveDocument(
  input: { buffer: Buffer; mimeType: string | null },
  ocrAdapter: OcrAdapter,
): Promise<SensitiveDocumentKind> {
  if (!input.mimeType || !OCR_SUPPORTED_MIME_TYPES.has(input.mimeType)) return "none";

  const text = await ocrAdapter.recognizeText(input.buffer);
  if (!text) return "none";

  if (detectCreditCard(text)) return "credit_card";
  if (detectMrz(text)) return "id_document";
  return "none";
}
