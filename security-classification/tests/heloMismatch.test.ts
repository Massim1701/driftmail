import { describe, expect, it } from "vitest";
import { detectHeloMismatch } from "../src/heloMismatch.js";

describe("detectHeloMismatch", () => {
  it("returns false when the HELO hostname matches the sender domain", () => {
    const headers = {
      Received: "from mail.example.com (mail.example.com [93.184.216.34]) by mx.google.com with ESMTPS id abc",
      From: "Rechnung <rechnung@example.com>",
    };
    expect(detectHeloMismatch(headers)).toBe(false);
  });

  it("returns false when the HELO hostname is a subdomain of the sender domain", () => {
    const headers = {
      Received: "from mx1.mail.example.com (mx1.mail.example.com [93.184.216.1]) by mx.google.com with ESMTPS id abc",
      From: "rechnung@example.com",
    };
    expect(detectHeloMismatch(headers)).toBe(false);
  });

  it("returns true when the HELO hostname is clearly unrelated to the sender domain", () => {
    const headers = {
      Received:
        "from webmail.totally-different-domain.ru (webmail.totally-different-domain.ru [203.0.113.9]) by mx.google.com with ESMTPS id xyz",
      From: "Amazon <no-reply@amazon.de>",
    };
    expect(detectHeloMismatch(headers)).toBe(true);
  });

  it("prefers an explicit (EHLO xxx) hint over the plain 'from' token", () => {
    const headers = {
      Received: "from [203.0.113.7] (EHLO malicious-host.example) by mx.example.com with SMTP id def",
      From: "billing@bank-example.com",
    };
    expect(detectHeloMismatch(headers)).toBe(true);
  });

  it("falls back to the parenthesized hostname when the 'from' token is a bare IP literal", () => {
    const matching = {
      Received: "from [203.0.113.7] (mail.example.com [203.0.113.7]) by mx.google.com with ESMTPS id ghi",
      From: "rechnung@example.com",
    };
    expect(detectHeloMismatch(matching)).toBe(false);

    const mismatching = {
      Received: "from [203.0.113.7] (mail.evil-example.ru [203.0.113.7]) by mx.google.com with ESMTPS id ghi",
      From: "rechnung@example.com",
    };
    expect(detectHeloMismatch(mismatching)).toBe(true);
  });

  it("returns false (no signal) when there is no Received header at all", () => {
    expect(detectHeloMismatch({ From: "a@example.com" })).toBe(false);
  });

  it("returns false (no signal) when the Received header only carries a bare IP with no hostname", () => {
    const headers = {
      Received: "from [203.0.113.5] by mx.example.com with SMTP id jkl",
      From: "a@example.com",
    };
    expect(detectHeloMismatch(headers)).toBe(false);
  });

  it("returns false (no signal) when there is no From header to compare against", () => {
    const headers = {
      Received: "from webmail.totally-different-domain.ru (webmail.totally-different-domain.ru [203.0.113.9]) by mx.example.com with SMTP id mno",
    };
    expect(detectHeloMismatch(headers)).toBe(false);
  });

  it("is case-insensitive on header keys", () => {
    const headers = {
      received: "from webmail.totally-different-domain.ru (webmail.totally-different-domain.ru [203.0.113.9]) by mx.example.com with SMTP id pqr",
      from: "no-reply@amazon.de",
    };
    expect(detectHeloMismatch(headers)).toBe(true);
  });

  it("known limitation: legitimate mail via a third-party relay reads as a mismatch (documented false positive)", () => {
    // Google Workspace, Mailchimp, SendGrid & Co. senden mit einem
    // HELO-Hostnamen auf einer ganz anderen Domain als der Absender -- das
    // ist normal, kein Botnetz-Indiz. Diese Heuristik allein kann das nicht
    // unterscheiden (siehe Kommentar in src/heloMismatch.ts), deshalb darf
    // sie im Aufrufer nie alleinstehend eine Löschentscheidung auslösen.
    const headers = {
      Received: "from mail-sor-f41.google.com (mail-sor-f41.google.com [209.85.220.41]) by mx.example.com with SMTPS id stu",
      From: "Newsletter <news@example-shop.com>",
    };
    expect(detectHeloMismatch(headers)).toBe(true);
  });
});
