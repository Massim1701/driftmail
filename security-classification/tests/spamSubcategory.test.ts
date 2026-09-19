import { describe, expect, it } from "vitest";
import { detectSpamSubcategory } from "../src/spamSubcategory.js";

describe("detectSpamSubcategory", () => {
  it("detects explicit adult content from a single strong keyword", () => {
    expect(
      detectSpamSubcategory("Sieh dir jetzt heiße XXX Videos an, kostenlos und ohne Anmeldung!"),
    ).toBe("adult");
  });

  it("detects explicit gambling content from a single strong keyword", () => {
    expect(
      detectSpamSubcategory(
        "Riesiger Casino Bonus ohne Einzahlung wartet auf dich, jetzt Freispiele sichern!",
      ),
    ).toBe("gambling");
  });

  it("is case-insensitive for keyword matching", () => {
    expect(detectSpamSubcategory("CASINO BONUS OHNE EINZAHLUNG wartet auf dich")).toBe("gambling");
  });

  it("does not classify a single weak adult signal as adult (needs >= 2 weak hits)", () => {
    expect(detectSpamSubcategory("Erotik Newsletter mit tollen Angeboten")).not.toBe("adult");
  });

  it("classifies two weak adult signals together as adult", () => {
    expect(
      detectSpamSubcategory("Erotik pur: Sexkontakt in deiner Nähe, jetzt anmelden!"),
    ).toBe("adult");
  });

  it("does not classify a single weak gambling signal as gambling (needs >= 2 weak hits)", () => {
    expect(detectSpamSubcategory("Unser Hotel hat auch ein Casino im Haus.")).not.toBe("gambling");
  });

  it("classifies discount/promo language as marketing", () => {
    expect(
      detectSpamSubcategory("50% Rabatt nur heute! Gutscheincode: SUMMER50. Jetzt bestellen."),
    ).toBe("marketing");
  });

  it("defaults to generic when no specific signal is found", () => {
    expect(detectSpamSubcategory("Wir haben ein neues Angebot für Sie, schauen Sie mal vorbei.")).toBe(
      "generic",
    );
  });

  it("prefers adult over marketing when both signals are present", () => {
    expect(
      detectSpamSubcategory("XXX Videos gratis, dazu 50% Rabatt auf Premium-Zugang! Gutschein sichern."),
    ).toBe("adult");
  });

  it("detects a classic advance-fee-scam pattern from a single strong keyword", () => {
    expect(
      detectSpamSubcategory(
        "Ich bin der Anwalt eines verstorbenen Geschäftsmann, der Ihnen als next of kin ein Vermögen hinterlassen hat.",
      ),
    ).toBe("advance_fee_scam");
  });

  it("does not classify a single weak advance-fee-scam signal alone (needs >= 2 weak hits)", () => {
    expect(detectSpamSubcategory("Wir bieten eine Erbschaftsberatung für Ihre Familie an.")).not.toBe(
      "advance_fee_scam",
    );
  });

  it("classifies two weak advance-fee-scam signals together as advance_fee_scam", () => {
    expect(
      detectSpamSubcategory(
        "Es geht um eine Erbschaft von mehreren Millionen US-Dollar, bitte antworten Sie unter strengster Geheimhaltung.",
      ),
    ).toBe("advance_fee_scam");
  });
});
