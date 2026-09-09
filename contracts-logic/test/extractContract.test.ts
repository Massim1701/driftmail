import { describe, expect, it } from "vitest";
import { extractContract } from "../src/extractContract.js";
import { LOW_CONFIDENCE_THRESHOLD } from "../src/types.js";

describe("extractContract", () => {
  it("returns null for text with no contract signal at all", async () => {
    const result = await extractContract(
      "Hi Max, wollen wir morgen Mittagessen gehen? Grüße, Anna"
    );
    expect(result).toBeNull();
  });

  it("extracts provider, dates and cancellation period from a well-formed German contract mail", async () => {
    const text = `
      Sehr geehrte Kundin, sehr geehrter Kunde,

      hiermit bestätigen wir Ihren Vertrag mit der Musterstrom GmbH.

      Vertragsbeginn: 01.03.2026
      Vertragsende: 28.02.2028
      Kündigungsfrist: 3 Monate zum Vertragsende, kündbar bis 30.11.2027.

      Mit freundlichen Grüßen
      Musterstrom GmbH
    `;

    const result = await extractContract(text);

    expect(result).not.toBeNull();
    expect(result!.providerName).toMatch(/Musterstrom/);
    expect(result!.contractStart).toBe("2026-03-01");
    expect(result!.contractEnd).toBe("2028-02-28");
    expect(result!.cancellationDeadline).toBe("2027-11-30");
    expect(result!.cancellationPeriodDays).toBe(90); // 3 Monate * 30
    expect(result!.extractedConfidence).toBeGreaterThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it("extracts a provider via legal-form suffix pattern without explicit label", async () => {
    const text = "Ihre Rechnung von Telecomexample AG liegt bei. Betrag: 29,99 EUR.";
    const result = await extractContract(text);
    expect(result).not.toBeNull();
    expect(result!.providerName).toMatch(/Telecomexample AG/);
  });

  it("recognizes an explicit 'Anbieter:' label with the highest provider confidence", async () => {
    const text = "Anbieter: Fitnessstudio Nord\nSonst nichts weiter Vertragsrelevantes.";
    const result = await extractContract(text);
    expect(result).not.toBeNull();
    expect(result!.providerName).toBe("Fitnessstudio Nord");
  });

  it("supports ISO dates directly", async () => {
    const text = "Vertragsbeginn: 2026-01-15\nAnbieter: Testfirma GmbH";
    const result = await extractContract(text);
    expect(result!.contractStart).toBe("2026-01-15");
  });

  it("returns low confidence and null fields when only a weak signal is present", async () => {
    const text = "Wir wünschen Ihnen alles Gute mit Ihrer Muster & Partner KG.";
    const result = await extractContract(text);
    expect(result).not.toBeNull();
    expect(result!.contractStart).toBeNull();
    expect(result!.contractEnd).toBeNull();
    expect(result!.extractedConfidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it("converts weeks correctly to days for cancellation period", async () => {
    const text = "Anbieter: Test GmbH\nKündigungsfrist von 6 Wochen zum Laufzeitende.";
    const result = await extractContract(text);
    expect(result!.cancellationPeriodDays).toBe(42);
  });
});
