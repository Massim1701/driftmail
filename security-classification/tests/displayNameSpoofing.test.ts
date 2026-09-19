import { describe, expect, it } from "vitest";
import { detectDisplayNameSpoofing } from "../src/displayNameSpoofing.js";

describe("detectDisplayNameSpoofing", () => {
  it("detects a known brand name in the display name with a mismatching domain", () => {
    expect(
      detectDisplayNameSpoofing({ From: "PayPal Support <support@paypal-security-check.example>" }),
    ).toBe(true);
  });

  it("does not flag the brand's own domain", () => {
    expect(detectDisplayNameSpoofing({ From: "PayPal Support <support@paypal.com>" })).toBe(false);
  });

  it("does not flag the brand's own subdomain", () => {
    expect(detectDisplayNameSpoofing({ From: "PayPal Support <no-reply@mail.paypal.com>" })).toBe(false);
  });

  it("is case-insensitive for the brand name in the display name", () => {
    expect(
      detectDisplayNameSpoofing({ From: "PAYPAL SUPPORT <support@paypal-security-check.example>" }),
    ).toBe(true);
  });

  it("returns false without a display name (bare address only)", () => {
    expect(detectDisplayNameSpoofing({ From: "support@paypal-security-check.example" })).toBe(false);
  });

  it("returns false without a From header", () => {
    expect(detectDisplayNameSpoofing({})).toBe(false);
  });

  it("returns false when the display name mentions no known brand", () => {
    expect(detectDisplayNameSpoofing({ From: "Anna Kollegin <kollegin@example.com>" })).toBe(false);
  });
});
