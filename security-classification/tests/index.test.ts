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
        "confidenceScore",
      ].sort(),
    );
  });
});
