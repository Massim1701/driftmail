import { describe, expect, it } from "vitest";
import { detectHomoglyphs, isMixedScriptLabel, containsConfusableChar, extractDomains } from "../src/homoglyph.js";

describe("extractDomains", () => {
  it("finds domain-like tokens in free text", () => {
    expect(extractDomains("Bitte besuchen Sie www.example.com für mehr Infos.")).toContain(
      "www.example.com",
    );
  });
});

describe("isMixedScriptLabel", () => {
  it("flags a label mixing Latin and Cyrillic characters", () => {
    // "аpple" -- first character is Cyrillic 'а' (U+0430), rest is Latin.
    expect(isMixedScriptLabel("аpple")).toBe(true);
  });

  it("does not flag a pure-Latin label", () => {
    expect(isMixedScriptLabel("apple")).toBe(false);
  });
});

describe("containsConfusableChar", () => {
  it("flags an all-Cyrillic lookalike of a Latin word", () => {
    // "аррӏе" built entirely from Cyrillic confusables for a-p-p-l-e-ish shape
    expect(containsConfusableChar("аррle")).toBe(true);
  });

  it("does not flag plain ASCII", () => {
    expect(containsConfusableChar("apple")).toBe(false);
  });
});

describe("detectHomoglyphs", () => {
  it("detects a homoglyph domain in the From header", () => {
    const rawText = "Bitte loggen Sie sich ein, um Ihr Konto zu bestätigen.";
    const headers = { From: "Support <support@аpple.com>" }; // Cyrillic а
    expect(detectHomoglyphs(rawText, headers)).toBe(true);
  });

  it("detects a homoglyph domain in the body text", () => {
    const rawText = "Besuchen Sie https://аpple-support.com um fortzufahren.";
    expect(detectHomoglyphs(rawText, {})).toBe(true);
  });

  it("returns false for a legitimate, pure-ASCII sender and body", () => {
    const rawText = "Ihre Rechnung für September liegt bei. Grüße, das Team.";
    const headers = { From: "Rechnung <rechnung@example.com>" };
    expect(detectHomoglyphs(rawText, headers)).toBe(false);
  });
});
