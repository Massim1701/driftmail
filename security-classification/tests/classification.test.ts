import { describe, expect, it } from "vitest";
import { classify } from "../src/classification.js";

describe("classify", () => {
  it("classifies as 'safe' when auth passes and there are no other signals", () => {
    const result = classify({
      spfStatus: "pass",
      dkimStatus: "pass",
      dmarcStatus: "pass",
      homoglyphDetected: false,
      linkMismatchDetected: false,
      urgencyLanguageScore: 0,
      containsNewIban: false,
    });
    expect(result.classification).toBe("safe");
  });

  it("classifies as 'phishing' when auth fails plus homoglyph plus link mismatch", () => {
    const result = classify({
      spfStatus: "fail",
      dkimStatus: "fail",
      dmarcStatus: "fail",
      homoglyphDetected: true,
      linkMismatchDetected: true,
      urgencyLanguageScore: 0.9,
      containsNewIban: true,
    });
    expect(result.classification).toBe("phishing");
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("classifies as 'unclear' when signals are mixed/inconclusive", () => {
    const result = classify({
      spfStatus: "none",
      dkimStatus: "none",
      dmarcStatus: "none",
      homoglyphDetected: false,
      linkMismatchDetected: false,
      urgencyLanguageScore: 0,
      containsNewIban: false,
    });
    expect(result.classification).toBe("unclear");
  });

  it("does not treat a new IBAN alone (no urgency, no link mismatch) as a strong signal", () => {
    const result = classify({
      spfStatus: "pass",
      dkimStatus: "pass",
      dmarcStatus: "pass",
      homoglyphDetected: false,
      linkMismatchDetected: false,
      urgencyLanguageScore: 0,
      containsNewIban: true,
    });
    expect(result.classification).not.toBe("phishing");
  });

  it("always returns a confidenceScore between 0 and 1", () => {
    const result = classify({
      spfStatus: "fail",
      dkimStatus: "pass",
      dmarcStatus: "none",
      homoglyphDetected: true,
      linkMismatchDetected: false,
      urgencyLanguageScore: 0.4,
      containsNewIban: false,
    });
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });
});
