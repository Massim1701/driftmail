// Einzige Stelle, die die konkrete OcrAdapter-Implementierung verdrahtet --
// analog zu src/lookups/index.ts. Austausch gegen einen echten Cloud-OCR-
// Dienst (falls die Qualität von tesseract.js bei echten, unscharfen Fotos
// nicht ausreicht) betrifft nur diese eine Zeile.
import { TesseractOcrAdapter } from "./tesseractOcrAdapter";
import type { OcrAdapter } from "./types";

export const ocrAdapter: OcrAdapter = new TesseractOcrAdapter();

export { scanForSensitiveDocument } from "./sensitiveDocumentScan";
export type { OcrAdapter } from "./types";
