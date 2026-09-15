// OCR-Adapter für die Sensible-Dokument-Erkennung (WEB_INBOX.md 15.09.
// "Sensible-Daten-Erkennung um Fotos von Ausweisen/Kreditkarten erweitern").
// Gleiches Grundmuster wie src/ai/types.ts (AiAdapter) und
// src/lookups/types.ts: ein austauschbares Interface, Aufrufer
// (sensitiveDocumentScan.ts) kennt nur dieses, nicht die konkrete
// Implementierung. Aktuell EINE reale Implementierung (tesseractOcrAdapter.ts,
// tesseract.js, läuft lokal/offline) statt eines Mocks -- anders als bei den
// externen Lookups (WHOIS/Spamhaus/Fraud-DB brauchen echte externe
// Zugangsdaten, die hier nicht verfügbar sind), ist Text-Erkennung aus einem
// Bild ohne externen Dienst/API-Key möglich und wurde deshalb echt gebaut,
// nicht gemockt. Für einen echten Cloud-OCR-Dienst (z.B. bei
// Qualitätsproblemen mit echten, unscharfen Fotos) betrifft der Austausch
// nur src/attachments/index.ts.
export interface OcrAdapter {
  /** Liefert den per OCR erkannten Text, oder "" wenn kein Text erkennbar
   * war (kein Fehler -- ein Bild ohne Text ist ein valider Fall). */
  recognizeText(imageBuffer: Buffer): Promise<string>;

  /** Beendet einen ggf. im Hintergrund laufenden OCR-Worker (worker_threads
   * bei tesseract.js) -- ohne das haelt ein einmal erzeugter Worker den
   * Node-Prozess am Leben, `server.close()` allein reicht dann nicht zum
   * sauberen Beenden (siehe Aufruf in smoketest.ts). Optional, da ein
   * echter, dauerhaft laufender Server-Prozess (index.ts) das nie aufrufen
   * muss. */
  terminate?(): Promise<void>;
}
