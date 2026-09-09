import { describe, expect, it } from "vitest";
import { detectsCredentialOrPaymentRequest } from "../src/credentialRequestLanguage.js";

describe("detectsCredentialOrPaymentRequest", () => {
  it("detects a German password-confirmation request", () => {
    expect(
      detectsCredentialOrPaymentRequest("Bitte Passwort bestätigen, um fortzufahren."),
    ).toBe(true);
  });

  it("detects a German account-verification request", () => {
    expect(detectsCredentialOrPaymentRequest("Sie müssen Ihr Konto verifizieren.")).toBe(true);
  });

  it("detects a German payment-data update request", () => {
    expect(
      detectsCredentialOrPaymentRequest("Bitte umgehend Zahlungsdaten aktualisieren."),
    ).toBe(true);
  });

  it("detects an English payment-details request", () => {
    expect(detectsCredentialOrPaymentRequest("Please update your payment details now.")).toBe(
      true,
    );
  });

  it("is case-insensitive", () => {
    expect(detectsCredentialOrPaymentRequest("BITTE KONTO VERIFIZIEREN")).toBe(true);
  });

  it("returns false for harmless text without a credential/payment request", () => {
    expect(detectsCredentialOrPaymentRequest("Danke für Ihre Nachricht, schönen Tag noch.")).toBe(
      false,
    );
  });

  it("returns false for urgent text that does not ask for credentials/payment data", () => {
    expect(
      detectsCredentialOrPaymentRequest("Bitte antworten Sie dringend bis Freitag."),
    ).toBe(false);
  });
});
