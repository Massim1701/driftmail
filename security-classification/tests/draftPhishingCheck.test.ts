import { describe, expect, it } from "vitest";
import { checkDraftForPhishing } from "../src/draftPhishingCheck.js";

const VALID_IBAN_SPACED = "DE89 3704 0044 0532 0130 00";
const VALID_CARD_NUMBER = "4111111111111111"; // Luhn-gültig, siehe creditCardDetection.test.ts

describe("checkDraftForPhishing", () => {
  it("blocks an unambiguous phishing draft (link mismatch)", () => {
    const result = checkDraftForPhishing("Bitte loggen Sie sich hier ein, um fortzufahren.", [
      { displayText: "www.paypal.com", actualUrl: "https://login-verify.example-evil.ru/x" },
    ]);

    expect(result.blocked).toBe(true);
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("Anzeigetext");
    expect(result.riskyLinks).toEqual([
      {
        url: "https://login-verify.example-evil.ru/x",
        reason: expect.stringContaining("Anzeigetext"),
      },
    ]);
  });

  it("blocks a draft with a homoglyph domain in a link, even without a display-text mismatch", () => {
    // Anzeigetext ist keine Domain, also kein Link-Mismatch-Signal -- nur
    // der Homoglyph in der Ziel-Domain ("аpple.com" mit kyrillischem "а")
    // löst hier den Block aus.
    const result = checkDraftForPhishing("Hier klicken, um Ihr Konto zu verwalten.", [
      { displayText: "Hier klicken", actualUrl: "https://аpple.com/account" },
    ]);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Homoglyph");
    expect(result.riskyLinks).toHaveLength(1);
    expect(result.riskyLinks[0]?.reason).toContain("Homoglyph");
  });

  it("blocks a draft combining urgency language with a credential request, even without any link", () => {
    const bodyText =
      "DRINGEND: Ihr Konto wird gesperrt! Bitte umgehend Passwort bestätigen, sonst wird Ihr Konto endgültig gesperrt!!!";

    const result = checkDraftForPhishing(bodyText, []);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Dringlichkeits");
    expect(result.riskyLinks).toEqual([]);
  });

  it("does not block on urgency language alone, without a credential/payment request", () => {
    const bodyText =
      "DRINGEND: bitte antworten Sie umgehend, das Angebot läuft heute ab! Handeln Sie jetzt!";

    const result = checkDraftForPhishing(bodyText, []);

    expect(result.blocked).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("does not block on a credential request alone, without urgency language", () => {
    const bodyText = "Zur Erinnerung: bitte im Portal Ihr Konto verifizieren, wenn Sie Zeit haben.";

    const result = checkDraftForPhishing(bodyText, []);

    expect(result.blocked).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("does not block a harmless draft that contains an IBAN, but flags it as sensitive data", () => {
    const bodyText = `Hallo, hier meine Bankverbindung für die Rückerstattung: ${VALID_IBAN_SPACED}. Vielen Dank!`;

    const result = checkDraftForPhishing(bodyText, []);

    expect(result.blocked).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.containsSensitiveData).toEqual(["iban"]);
  });

  it("flags a credit card number in the draft as sensitive data without blocking", () => {
    const bodyText = `Zur Abrechnung, hier meine Kartennummer: ${VALID_CARD_NUMBER}.`;

    const result = checkDraftForPhishing(bodyText, []);

    expect(result.blocked).toBe(false);
    expect(result.containsSensitiveData).toEqual(["credit_card"]);
  });

  it("flags both IBAN and credit card when both are present", () => {
    const bodyText = `IBAN: ${VALID_IBAN_SPACED} -- Karte: ${VALID_CARD_NUMBER}`;

    const result = checkDraftForPhishing(bodyText, []);

    expect(result.containsSensitiveData).toEqual(["iban", "credit_card"]);
  });

  it("returns an empty containsSensitiveData array when no sensitive data is present", () => {
    const result = checkDraftForPhishing("Vielen Dank für Ihre Nachricht.", []);
    expect(result.containsSensitiveData).toEqual([]);
  });

  it("reports risky links for a draft with a suspicious link", () => {
    const result = checkDraftForPhishing("Bitte hier klicken.", [
      { displayText: "www.bank.de", actualUrl: "https://phishy.example.com/x" },
    ]);

    expect(result.riskyLinks.length).toBeGreaterThan(0);
    expect(result.riskyLinks[0]?.url).toBe("https://phishy.example.com/x");
  });

  it("returns an empty riskyLinks array for a draft with only benign links", () => {
    const result = checkDraftForPhishing("Mehr Infos hier.", [
      { displayText: "www.example.com", actualUrl: "https://www.example.com/info" },
      { displayText: "Hier klicken", actualUrl: "https://example.com/x" },
    ]);

    expect(result.riskyLinks).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("always returns recipientReputation 'unknown' (no DB access to fraud_alerts/recipient history)", () => {
    const harmless = checkDraftForPhishing("Hallo, vielen Dank!", []);
    const phishing = checkDraftForPhishing("Klicken Sie hier:", [
      { displayText: "www.paypal.com", actualUrl: "https://evil.example.ru/login" },
    ]);

    expect(harmless.recipientReputation).toBe("unknown");
    expect(phishing.recipientReputation).toBe("unknown");
  });
});
