import { describe, expect, it } from "vitest";
import { detectNewIban, extractIbans } from "../src/ibanDetection.js";

// DE89 3704 0044 0532 0130 00 ist die häufig als Beispiel verwendete, gültige
// deutsche Test-IBAN (korrekte Mod-97-Prüfsumme).
const VALID_IBAN_SPACED = "DE89 3704 0044 0532 0130 00";
const VALID_IBAN_COMPACT = "DE89370400440532013000";

describe("extractIbans", () => {
  it("finds a valid, space-formatted IBAN in text", () => {
    const text = `Bitte überweisen Sie den Betrag auf folgendes Konto: ${VALID_IBAN_SPACED}.`;
    expect(extractIbans(text)).toEqual([VALID_IBAN_COMPACT]);
  });

  it("finds a valid, compact IBAN in text", () => {
    const text = `IBAN: ${VALID_IBAN_COMPACT}`;
    expect(extractIbans(text)).toEqual([VALID_IBAN_COMPACT]);
  });

  it("does not flag an invalid checksum as an IBAN", () => {
    const text = "IBAN: DE00 0000 0000 0000 0000 00";
    expect(extractIbans(text)).toEqual([]);
  });

  it("returns an empty array for text without an IBAN", () => {
    expect(extractIbans("Vielen Dank für Ihre Nachricht.")).toEqual([]);
  });

  it("deduplicates repeated occurrences of the same IBAN", () => {
    const text = `${VALID_IBAN_SPACED} ... nochmal zur Sicherheit: ${VALID_IBAN_COMPACT}`;
    expect(extractIbans(text)).toEqual([VALID_IBAN_COMPACT]);
  });
});

describe("detectNewIban", () => {
  it("returns true when a valid IBAN is present (proxy signal, see README)", () => {
    expect(detectNewIban(`Neue Bankverbindung: ${VALID_IBAN_SPACED}`)).toBe(true);
  });

  it("returns false when no valid IBAN is present", () => {
    expect(detectNewIban("Keine Bankdaten in dieser Mail.")).toBe(false);
  });
});
