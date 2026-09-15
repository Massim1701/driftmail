import { describe, expect, it } from "vitest";
import { detectMrz } from "../src/mrzDetection.js";

// Synthetische TD3-MRZ (Reisepass), zwei Zeilen à 44 Zeichen -- nicht
// pruefzifferngueltig (bewusst, siehe Kommentar in mrzDetection.ts).
const CLEAN_TD3_LINE1 = "P<D<<MUSTERMANN<<MAX<<<<<<<<<<<<<<<<<<<<<<<<";
const CLEAN_TD3_LINE2 = "C01X00T47D<6408125M2702283<<<<<<<<<<<<<<06";

// Echter OCR-Output (tesseract.js) eines gerenderten Testbilds mit obiger
// MRZ -- ein "O" wurde faelschlich in Zeile 2 eingefuegt, Zeile 1 hat zwei
// Zeichen ("I", "L") statt "<" am Ende. Beweist, dass die Erkennung echten
// OCR-Fehlern standhaelt, nicht nur dem sauberen Idealfall.
const NOISY_OCR_MRZ = [
  "PASSPORT / REISEPASS",
  "P<D<<MUSTERMANN<<MAX<<<<<<<<<<<<<<<<<<<<<I<<<<L<",
  "CO01X00T47D<6408125M2702283<<<<<<<<<<<<<<06",
].join("\n");

describe("detectMrz", () => {
  it("detects a clean, two-line TD3 MRZ", () => {
    expect(detectMrz(`${CLEAN_TD3_LINE1}\n${CLEAN_TD3_LINE2}`)).toBe(true);
  });

  it("detects a real, OCR-noisy MRZ (echte tesseract.js-Ausgabe, siehe Kommentar)", () => {
    expect(detectMrz(NOISY_OCR_MRZ)).toBe(true);
  });

  it("returns false for normal email text", () => {
    expect(detectMrz("Hallo Massimo,\n\nanbei die Unterlagen.\n\nViele Grüße")).toBe(false);
  });

  it("returns false for a single MRZ-shaped line without a second consecutive one", () => {
    expect(detectMrz(`Betreff: Dokument\n${CLEAN_TD3_LINE1}\nMit freundlichen Grüßen`)).toBe(false);
  });

  it("returns false for long uppercase text without '<' filler characters", () => {
    const text =
      "SEHR GEEHRTE DAMEN UND HERREN WIR BESTAETIGEN IHRE BESTELLUNG\nDIE LIEFERUNG ERFOLGT IN KUERZE AN IHRE ADRESSE VIELEN DANK";
    expect(detectMrz(text)).toBe(false);
  });

  it("is case-insensitive (OCR case detection is unreliable, normalizes to uppercase)", () => {
    expect(detectMrz(`${CLEAN_TD3_LINE1.toLowerCase()}\n${CLEAN_TD3_LINE2}`)).toBe(true);
  });

  it("returns false for MRZ-length lines containing punctuation instead of '<' filler", () => {
    const punctuated = CLEAN_TD3_LINE1.replace(/</g, ".");
    expect(detectMrz(`${punctuated}\n${CLEAN_TD3_LINE2}`)).toBe(false);
  });
});
