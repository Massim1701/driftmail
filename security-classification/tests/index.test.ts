import { describe, expect, it } from "vitest";
import { analyzeMail } from "../src/index.js";

describe("analyzeMail (integration)", () => {
  it("classifies a legitimate, well-authenticated mail as safe", async () => {
    const rawText =
      "Hallo, anbei Ihre Rechnung für September. Bei Fragen antworten Sie gern auf diese E-Mail. Viele Grüße, Ihr Team.";
    const headers = {
      From: "Rechnung <rechnung@example.com>",
      "Authentication-Results":
        "mx.example.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass",
    };

    const result = await analyzeMail(rawText, headers);

    expect(result).toEqual({
      spfStatus: "pass",
      dkimStatus: "pass",
      dmarcStatus: "pass",
      senderDomainAgeDays: null,
      domainReputationScore: null,
      homoglyphDetected: false,
      linkMismatchDetected: false,
      urgencyLanguageScore: 0,
      containsNewIban: false,
      classification: "safe",
      spamSubcategory: null,
      confidenceScore: expect.any(Number),
    });
  });

  it("classifies a phishing mail (auth fail + homoglyph + link mismatch + urgency + IBAN) as phishing", async () => {
    const rawText = `
      <p>DRINGEND: Ihr Konto wurde gesperrt! Bestätigen Sie sofort Ihre Daten,
      sonst wird Ihr Konto endgültig gesperrt!!!</p>
      <p>Bitte loggen Sie sich hier ein:
      <a href="https://login-verify.example-evil.ru/x">www.paypal.com</a></p>
      <p>Alternativ überweisen Sie direkt an unsere neue Bankverbindung:
      DE89 3704 0044 0532 0130 00</p>
    `;
    const headers = {
      From: "PayPal Support <support@pаypal.com>", // Cyrillic а in "paypal"
      "Authentication-Results": "mx.example.com; spf=fail; dkim=fail; dmarc=fail",
    };

    const result = await analyzeMail(rawText, headers);

    expect(result.spfStatus).toBe("fail");
    expect(result.dkimStatus).toBe("fail");
    expect(result.dmarcStatus).toBe("fail");
    expect(result.homoglyphDetected).toBe(true);
    expect(result.linkMismatchDetected).toBe(true);
    expect(result.urgencyLanguageScore).toBeGreaterThan(0.5);
    expect(result.containsNewIban).toBe(true);
    expect(result.classification).toBe("phishing");
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("always returns senderDomainAgeDays and domainReputationScore as null (out of scope for this module)", async () => {
    const result = await analyzeMail("Hallo Welt", {});
    expect(result.senderDomainAgeDays).toBeNull();
    expect(result.domainReputationScore).toBeNull();
  });

  it("returns a result matching the SecurityResult shape from contracts/ai-adapter-interface.ts", async () => {
    const result = await analyzeMail("Test", {});
    expect(Object.keys(result).sort()).toEqual(
      [
        "spfStatus",
        "dkimStatus",
        "dmarcStatus",
        "senderDomainAgeDays",
        "domainReputationScore",
        "homoglyphDetected",
        "linkMismatchDetected",
        "urgencyLanguageScore",
        "containsNewIban",
        "classification",
        "spamSubcategory",
        "confidenceScore",
      ].sort(),
    );
  });

  describe("spamSubcategory", () => {
    // Auth-Fail allein reicht in der aktuellen classify()-Heuristik für
    // phishingScore=0.3, was in den "spam"-Bereich (0.25-0.5) fällt --
    // genug, um hier gezielt "spam" (nicht "phishing") zu erzeugen, ohne
    // Homoglyph/Link-Mismatch/IBAN mit ins Spiel zu bringen.
    const spamHeaders = {
      "Authentication-Results": "mx.example.com; spf=fail; dkim=none; dmarc=none",
    };

    it("sets spamSubcategory 'adult' for spam with explicit adult content", async () => {
      const rawText = "Sieh dir jetzt heiße XXX Videos an, kostenlos und ohne Anmeldung!";
      const result = await analyzeMail(rawText, spamHeaders);
      expect(result.classification).toBe("spam");
      expect(result.spamSubcategory).toBe("adult");
    });

    it("sets spamSubcategory 'gambling' for spam with explicit gambling content", async () => {
      const rawText = "Riesiger Casino Bonus ohne Einzahlung wartet auf dich, jetzt Freispiele sichern!";
      const result = await analyzeMail(rawText, spamHeaders);
      expect(result.classification).toBe("spam");
      expect(result.spamSubcategory).toBe("gambling");
    });

    it("sets spamSubcategory 'marketing' for spam with discount/promo content", async () => {
      const rawText = "50% Rabatt nur heute! Gutscheincode: SUMMER50. Jetzt bestellen.";
      const result = await analyzeMail(rawText, spamHeaders);
      expect(result.classification).toBe("spam");
      expect(result.spamSubcategory).toBe("marketing");
    });

    it("sets spamSubcategory 'generic' for spam with no specific content signal", async () => {
      const rawText = "Wir haben ein neues Angebot für Sie, schauen Sie mal vorbei.";
      const result = await analyzeMail(rawText, spamHeaders);
      expect(result.classification).toBe("spam");
      expect(result.spamSubcategory).toBe("generic");
    });

    it("always returns spamSubcategory null for phishing, even with adult/gambling keywords present (hard contract rule)", async () => {
      const rawText = `
        <p>DRINGEND: Ihr Konto wurde gesperrt! Bestätigen Sie sofort Ihre Daten,
        sonst wird Ihr Konto endgültig gesperrt!!! Casino Bonus ohne Einzahlung, XXX Videos gratis.</p>
        <p>Bitte loggen Sie sich hier ein:
        <a href="https://login-verify.example-evil.ru/x">www.paypal.com</a></p>
        <p>Alternativ überweisen Sie direkt an unsere neue Bankverbindung:
        DE89 3704 0044 0532 0130 00</p>
      `;
      const headers = {
        From: "PayPal Support <support@pаypal.com>", // Cyrillic а in "paypal"
        "Authentication-Results": "mx.example.com; spf=fail; dkim=fail; dmarc=fail",
      };

      const result = await analyzeMail(rawText, headers);

      expect(result.classification).toBe("phishing");
      expect(result.spamSubcategory).toBeNull();
    });

    it("returns spamSubcategory null for a safe mail", async () => {
      const result = await analyzeMail("Hallo, anbei die Unterlagen zu unserem Gespräch.", {
        "Authentication-Results": "mx.example.com; spf=pass; dkim=pass; dmarc=pass",
      });
      expect(result.classification).toBe("safe");
      expect(result.spamSubcategory).toBeNull();
    });

    it("returns spamSubcategory null for an unclear mail", async () => {
      const result = await analyzeMail("Hallo Welt", {});
      expect(result.classification).toBe("unclear");
      expect(result.spamSubcategory).toBeNull();
    });
  });
});
