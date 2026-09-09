import { describe, expect, it } from "vitest";
import { detectCreditCard, extractCreditCardNumbers } from "../src/creditCardDetection.js";

// Bekannte, öffentlich als Test-/Beispielkartennummer verwendete Visa-Nummer
// (Luhn-gültig, wie z.B. von Zahlungsanbieter-Testsystemen genutzt).
const VALID_VISA_TEST_NUMBER = "4111111111111111";
const VALID_VISA_SPACED = "4111 1111 1111 1111";
// Letzte Ziffer manipuliert -> Luhn-Prüfsumme ungültig.
const INVALID_LUHN = "4111111111111112";

describe("extractCreditCardNumbers", () => {
  it("finds a valid, compact card number in text", () => {
    const text = `Bitte Kartennummer bestätigen: ${VALID_VISA_TEST_NUMBER}`;
    expect(extractCreditCardNumbers(text)).toEqual([VALID_VISA_TEST_NUMBER]);
  });

  it("finds a valid, space-formatted card number in text", () => {
    const text = `Karte: ${VALID_VISA_SPACED}`;
    expect(extractCreditCardNumbers(text)).toEqual([VALID_VISA_TEST_NUMBER]);
  });

  it("does not flag a number with an invalid Luhn checksum", () => {
    expect(extractCreditCardNumbers(`Nummer: ${INVALID_LUHN}`)).toEqual([]);
  });

  it("returns an empty array for text without a card number", () => {
    expect(extractCreditCardNumbers("Vielen Dank für Ihre Nachricht.")).toEqual([]);
  });

  it("deduplicates repeated occurrences of the same number", () => {
    const text = `${VALID_VISA_SPACED} ... nochmal zur Sicherheit: ${VALID_VISA_TEST_NUMBER}`;
    expect(extractCreditCardNumbers(text)).toEqual([VALID_VISA_TEST_NUMBER]);
  });
});

describe("detectCreditCard", () => {
  it("returns true when a Luhn-valid card number is present", () => {
    expect(detectCreditCard(`Meine Karte: ${VALID_VISA_TEST_NUMBER}`)).toBe(true);
  });

  it("returns false when no valid card number is present", () => {
    expect(detectCreditCard("Keine Kartendaten in dieser Mail.")).toBe(false);
  });
});
