// Reale OCR-Implementierung von OcrAdapter (siehe types.ts) über
// tesseract.js -- läuft vollständig lokal (WASM), kein externer Dienst,
// kein API-Key.
//
// Bewusst NUR das Englisch-Sprachmodell geladen, nicht "deu+eng": beide hier
// erkannten Muster (Kreditkarten-Ziffernfolgen, MRZ-"<"-Füllzeichen) sind
// KEIN natürlicher Fließtext, sondern strukturierter/maschinenlesbarer Code
// (die MRZ ist laut ICAO 9303 ohnehin sprachneutral). Ein zusätzliches
// deutsches Wörterbuchmodell versucht, Zeichen an bekannte deutsche Wörter
// anzupassen -- das verschlechtert die Erkennung hier nachweislich (lokal
// getestet: dieselbe MRZ-Testfixture lieferte mit "deu+eng" eine lange Folge
// von "Z"/"E" statt der tatsächlichen "<"-Füllzeichen, mit reinem "eng"
// sauberen, nur minimal verrauschten Text). Kein Kompromiss zulasten
// mehrsprachiger Mails: der umliegende Mail-/Dokument-Text selbst wird hier
// nicht semantisch interpretiert, nur nach den beiden festen Mustern
// durchsucht.
//
// Worker-Erzeugung dauert ~300-400ms (lokal gemessen) -- bewusst EIN
// wiederverwendeter Worker statt pro Aufruf neu erzeugt, da Anhang-Uploads
// zwar kein Hot-Path sind, ein Worker pro Bild aber unnötig wäre.
import { createWorker, type Worker } from "tesseract.js";
import type { OcrAdapter } from "./types";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

export class TesseractOcrAdapter implements OcrAdapter {
  async recognizeText(imageBuffer: Buffer): Promise<string> {
    const worker = await getWorker();
    const { data } = await worker.recognize(imageBuffer);
    return data.text ?? "";
  }

  async terminate(): Promise<void> {
    if (!workerPromise) return;
    const worker = await workerPromise;
    workerPromise = null;
    await worker.terminate();
  }
}
