import { describe, expect, it } from "vitest";
import { scoreUrgencyLanguage } from "../src/urgencyLanguage.js";

describe("scoreUrgencyLanguage", () => {
  it("scores 0 for a neutral, calm text", () => {
    expect(scoreUrgencyLanguage("Anbei die Unterlagen zu unserem Gespräch von gestern.")).toBe(0);
  });

  it("scores higher for text with multiple urgency phrases", () => {
    const text =
      "DRINGEND: Ihr Konto wurde gesperrt! Bestätigen Sie sofort Ihre Daten, sonst wird Ihr Konto endgültig gesperrt!!!";
    expect(scoreUrgencyLanguage(text)).toBeGreaterThan(0.5);
  });

  it("never exceeds 1.0", () => {
    const text = Array(20).fill("urgent immediately act now account suspended").join(". ");
    expect(scoreUrgencyLanguage(text)).toBeLessThanOrEqual(1);
  });

  it("is case-insensitive for keyword matching", () => {
    expect(scoreUrgencyLanguage("URGENT: please act now")).toBeGreaterThan(0);
  });
});
