import { describe, expect, it } from "vitest";
import { detectLinkMismatch, extractLinks } from "../src/linkMismatch.js";

describe("extractLinks", () => {
  it("extracts an HTML anchor's href and display text", () => {
    const html = '<a href="https://evil.example.ru/login">www.paypal.com</a>';
    expect(extractLinks(html)).toEqual([
      { displayText: "www.paypal.com", actualUrl: "https://evil.example.ru/login" },
    ]);
  });

  it("extracts a markdown-style link", () => {
    const text = "Bitte bestätigen: [www.bank.de](https://phishy.example.com/x)";
    expect(extractLinks(text)).toEqual([
      { displayText: "www.bank.de", actualUrl: "https://phishy.example.com/x" },
    ]);
  });
});

describe("detectLinkMismatch", () => {
  it("flags a link whose display text domain differs from the href domain", () => {
    const html = '<a href="https://evil.example.ru/login">www.paypal.com</a>';
    expect(detectLinkMismatch(html)).toBe(true);
  });

  it("does not flag a link where display text and href domain match", () => {
    const html = '<a href="https://www.paypal.com/login">www.paypal.com</a>';
    expect(detectLinkMismatch(html)).toBe(false);
  });

  it("does not flag a subdomain of the same domain", () => {
    const html = '<a href="https://mail.example.com/x">example.com</a>';
    expect(detectLinkMismatch(html)).toBe(false);
  });

  it("does not flag a link with non-domain display text (e.g. 'Hier klicken')", () => {
    const html = '<a href="https://example.com/x">Hier klicken</a>';
    expect(detectLinkMismatch(html)).toBe(false);
  });

  it("returns false when there are no links at all", () => {
    expect(detectLinkMismatch("Hallo, wie geht es Ihnen?")).toBe(false);
  });
});
