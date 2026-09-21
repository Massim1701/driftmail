// "Quishing"-Schutz (WEB_INBOX.md 21.09. "ZWEI ENTERPRISE-SICHERHEITS-
// FEATURES - echtes Alleinstellungsmerkmal", Punkt 1): Angreifer verstecken
// zunehmend boesartige Links in QR-Codes oder als Bild statt als klickbaren
// Text, um klassische Link-Erkennung zu umgehen (von Sophos 2026 als
// wachsender Trend benannt). Zwei Quellen, beide auf Bild-Anhaenge
// angewendet:
//
// 1) QR-Code-Decoder (jsqr + jimp zum Dekodieren der Bilddatei in rohe
//    Pixel-Daten, die jsQR braucht -- jsQR selbst kann kein JPEG/PNG lesen,
//    nur Uint8ClampedArray-Pixel).
// 2) OCR-erkannter Text (Wiederverwendung des bestehenden OcrAdapter aus
//    sensitiveDocumentScan.ts, kein zweiter OCR-Pfad) -- ein im Bild
//    sichtbarer, aber nicht als QR-Code kodierter Link.
//
// Gefundene URLs werden NICHT selbst neu bewertet (kein eigenes
// Phishing-Modell) -- sie durchlaufen dieselbe Homoglyph-Domain-Pruefung
// wie normale Text-Links aus @driftmail/security-classification
// (Wiederverwendung statt Neubau, wie im Auftrag ausdruecklich verlangt).

import { Jimp } from "jimp";
import jsQR from "jsqr";
import { extractDomains, isHomoglyphDomain } from "@driftmail/security-classification";
import type { OcrAdapter } from "./types";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

async function decodeQrCodeUrl(buffer: Buffer): Promise<string | null> {
  try {
    const image = await Jimp.read(buffer);
    const pixels = new Uint8ClampedArray(image.bitmap.data);
    const result = jsQR(pixels, image.bitmap.width, image.bitmap.height);
    return result?.data ?? null;
  } catch {
    // Kein gueltiges/dekodierbares Bild -- kein Fehler, einfach kein Fund
    // (analog zu OcrAdapter.recognizeText(), das bei fehlendem Text "" statt
    // eines Fehlers liefert).
    return null;
  }
}

/** true, wenn irgendeine im Bild gefundene URL (QR-Code-Inhalt ODER per OCR
 * erkannter Text) eine Homoglyph-verdaechtige Domain hat -- derselbe
 * Erkennungsmechanismus wie fuer normale Text-Links im Mail-Koerper. */
export async function detectQuishingInImage(
  input: { buffer: Buffer; mimeType: string | null },
  ocrAdapter: OcrAdapter,
): Promise<boolean> {
  if (!input.mimeType || !IMAGE_MIME_TYPES.has(input.mimeType)) return false;

  const urls: string[] = [];

  const qrUrl = await decodeQrCodeUrl(input.buffer);
  if (qrUrl) urls.push(qrUrl);

  const ocrText = await ocrAdapter.recognizeText(input.buffer);
  if (ocrText) urls.push(...(ocrText.match(URL_REGEX) ?? []));

  for (const url of urls) {
    const domains = extractDomains(url);
    if (domains.some((domain) => isHomoglyphDomain(domain))) return true;
  }
  return false;
}
