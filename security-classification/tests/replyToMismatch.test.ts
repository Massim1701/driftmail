import { describe, expect, it } from "vitest";
import { detectReplyToMismatch } from "../src/replyToMismatch.js";

describe("detectReplyToMismatch", () => {
  it("detects a Reply-To domain that differs from the From domain", () => {
    expect(
      detectReplyToMismatch({
        From: "Kundenservice <service@sicherheit-konto-check.tk>",
        "Reply-To": "reply@andere-domain.ru",
      }),
    ).toBe(true);
  });

  it("does not flag a Reply-To on the same domain (different local part)", () => {
    expect(
      detectReplyToMismatch({
        From: "Newsletter <no-reply@firma.de>",
        "Reply-To": "support@firma.de",
      }),
    ).toBe(false);
  });

  it("does not flag a Reply-To on a related subdomain", () => {
    expect(
      detectReplyToMismatch({
        From: "Notifications <notifications@mail.firma.de>",
        "Reply-To": "support@firma.de",
      }),
    ).toBe(false);
  });

  it("returns false without a Reply-To header", () => {
    expect(detectReplyToMismatch({ From: "Anna Kollegin <kollegin@example.com>" })).toBe(false);
  });

  it("returns false without a parseable From domain, even with Reply-To present", () => {
    expect(detectReplyToMismatch({ From: "Anna Kollegin", "Reply-To": "reply@andere-domain.ru" })).toBe(false);
  });
});
