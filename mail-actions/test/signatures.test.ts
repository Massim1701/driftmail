import { describe, expect, it } from "vitest";
import {
  SignatureStore,
  appendSignature,
  selectSignatureForContext,
  selectSignatureForNewMail,
  selectSignatureForReply,
} from "../src/signatures";
import type { SignatureRecord } from "../src/types";

const ACCOUNT_A = "11111111-1111-1111-1111-111111111111";
const ACCOUNT_B = "22222222-2222-2222-2222-222222222222";

function sig(overrides: Partial<SignatureRecord>): SignatureRecord {
  return {
    id: overrides.id ?? "sig-" + Math.random().toString(36).slice(2),
    mail_account_id: ACCOUNT_A,
    content_html: "<p>Sig</p>",
    is_default: false,
    apply_to_new: false,
    apply_to_replies: false,
    ...overrides,
  };
}

describe("selectSignatureForContext (reine Auswahl-Regel)", () => {
  it("faellt auf die Default-Signatur zurueck, wenn keine fuer den Kontext freigeschaltet ist", () => {
    // Entscheidung Web/Massimo 08.09. (SYNC.md): Default wird immer als
    // Fallback angehaengt, auch wenn ihr apply_to_new/apply_to_replies-Flag
    // fuer den Kontext nicht gesetzt ist.
    const defaultSig = sig({ id: "a", apply_to_new: false, apply_to_replies: false, is_default: true });
    const signatures = [defaultSig];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)).toEqual(defaultSig);
    expect(selectSignatureForReply(signatures, ACCOUNT_A)).toEqual(defaultSig);
  });

  it("liefert null, wenn weder Kontext-Flag noch Default-Signatur vorhanden ist", () => {
    const signatures = [
      sig({ id: "a", apply_to_new: false, apply_to_replies: false, is_default: false }),
    ];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)).toBeNull();
    expect(selectSignatureForReply(signatures, ACCOUNT_A)).toBeNull();
  });

  it("Default-Fallback gilt nur fuer Signaturen des angegebenen Accounts", () => {
    const signatures = [
      sig({ id: "a", mail_account_id: ACCOUNT_B, is_default: true }),
    ];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)).toBeNull();
  });

  it("liefert die einzige passende Signatur für 'new'", () => {
    const signatures = [
      sig({ id: "a", apply_to_new: true }),
      sig({ id: "b", apply_to_new: false }),
    ];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)?.id).toBe("a");
  });

  it("liefert die einzige passende Signatur für 'reply', unabhängig von apply_to_new", () => {
    const signatures = [
      sig({ id: "a", apply_to_new: true, apply_to_replies: false }),
      sig({ id: "b", apply_to_new: false, apply_to_replies: true }),
    ];
    expect(selectSignatureForReply(signatures, ACCOUNT_A)?.id).toBe("b");
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)?.id).toBe("a");
  });

  it("bricht Mehrdeutigkeit unter mehreren Kandidaten über is_default auf", () => {
    const signatures = [
      sig({ id: "a", apply_to_new: true, is_default: false }),
      sig({ id: "b", apply_to_new: true, is_default: true }),
    ];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)?.id).toBe("b");
  });

  it("fällt bei Mehrdeutigkeit ohne eindeutigen Default deterministisch auf den ersten Kandidaten zurück", () => {
    const signatures = [
      sig({ id: "a", apply_to_new: true, is_default: false }),
      sig({ id: "b", apply_to_new: true, is_default: false }),
    ];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)?.id).toBe("a");
  });

  it("berücksichtigt nur Signaturen des angegebenen mail_account_id", () => {
    const signatures = [
      sig({ id: "a", mail_account_id: ACCOUNT_A, apply_to_new: true }),
      sig({ id: "b", mail_account_id: ACCOUNT_B, apply_to_new: true }),
    ];
    expect(selectSignatureForNewMail(signatures, ACCOUNT_A)?.id).toBe("a");
    expect(selectSignatureForNewMail(signatures, ACCOUNT_B)?.id).toBe("b");
  });

  it("selectSignatureForContext mit context='new'/'reply' verhält sich wie die Shortcuts", () => {
    const signatures = [sig({ id: "a", apply_to_new: true, apply_to_replies: true })];
    expect(selectSignatureForContext(signatures, ACCOUNT_A, "new")?.id).toBe("a");
    expect(selectSignatureForContext(signatures, ACCOUNT_A, "reply")?.id).toBe("a");
  });
});

describe("appendSignature", () => {
  it("gibt den Body unverändert zurück, wenn keine Signatur ausgewählt wurde", () => {
    expect(appendSignature("<p>Body</p>", null)).toBe("<p>Body</p>");
  });

  it("hängt content_html mit Trenner an", () => {
    const s = sig({ content_html: "<p>Grüße, X</p>" });
    expect(appendSignature("<p>Body</p>", s)).toBe(
      "<p>Body</p>\n<br/>\n<p>Grüße, X</p>"
    );
  });

  it("ist idempotent: zweimaliges Anhängen derselben Signatur hängt sie nur einmal an", () => {
    // Klarstellung Web 08.09. (WEB_INBOX.md "Zwei Klarstellungen zum
    // Compose-/Antwort-Flow"): schützt gegen versehentlichen doppelten
    // Aufruf, z.B. in composeReplyDraft.
    const s = sig({ content_html: "<p>Grüße, X</p>" });
    const once = appendSignature("<p>Body</p>", s);
    const twice = appendSignature(once, s);
    expect(twice).toBe(once);
  });

  it("hängt die Signatur nicht an, wenn der Entwurfstext sie am Ende schon enthält", () => {
    const s = sig({ content_html: "<p>Grüße, X</p>" });
    const alreadySigned = "<p>Body</p>\n<br/>\n<p>Grüße, X</p>";
    expect(appendSignature(alreadySigned, s)).toBe(alreadySigned);
  });

  it("erkennt die vorhandene Signatur auch ohne den appendSignature-eigenen Trenner", () => {
    // z.B. wenn der Entwurfstext die Signatur aus einer anderen Quelle
    // (UI, bereits gespeicherter Entwurf) ohne "\n<br/>\n" enthält.
    const s = sig({ content_html: "<p>Grüße, X</p>" });
    const alreadySigned = "<p>Body</p><p>Grüße, X</p>";
    expect(appendSignature(alreadySigned, s)).toBe(alreadySigned);
  });
});

describe("SignatureStore", () => {
  it("macht die erste Signatur eines Accounts automatisch zum Default", () => {
    const store = new SignatureStore();
    const first = store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Erste</p>",
    });
    expect(first.is_default).toBe(true);
  });

  it("setzt beim Anlegen einer weiteren Default-Signatur den alten Default zurück", () => {
    const store = new SignatureStore();
    const first = store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Erste</p>",
    });
    const second = store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Zweite</p>",
      is_default: true,
    });

    expect(store.get(first.id)?.is_default).toBe(false);
    expect(store.get(second.id)?.is_default).toBe(true);
  });

  it("zweite Signatur ohne explizites is_default bleibt nicht-default", () => {
    const store = new SignatureStore();
    const first = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>1</p>" });
    const second = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>2</p>" });

    expect(store.get(first.id)?.is_default).toBe(true);
    expect(second.is_default).toBe(false);
  });

  it("setDefault wechselt den Default innerhalb desselben Accounts eindeutig", () => {
    const store = new SignatureStore();
    const a = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>A</p>" });
    const b = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>B</p>" });

    store.setDefault(ACCOUNT_A, b.id);

    expect(store.get(a.id)?.is_default).toBe(false);
    expect(store.get(b.id)?.is_default).toBe(true);
  });

  it("setDefault wirft, wenn die Signatur zu einem anderen Account gehört", () => {
    const store = new SignatureStore();
    const a = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>A</p>" });
    expect(() => store.setDefault(ACCOUNT_B, a.id)).toThrow();
  });

  it("create validiert nicht-leeren content_html", () => {
    const store = new SignatureStore();
    expect(() =>
      store.create({ mail_account_id: ACCOUNT_A, content_html: "   " })
    ).toThrow();
  });

  it("remove befördert bei Löschung des Defaults eine verbleibende Signatur zum neuen Default", () => {
    const store = new SignatureStore();
    const a = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>A</p>" });
    const b = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>B</p>" });

    expect(a.is_default).toBe(true);
    store.remove(a.id);

    const remaining = store.list(ACCOUNT_A);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
    expect(remaining[0]?.is_default).toBe(true);
  });

  it("remove der letzten Signatur eines Accounts hinterlässt eine leere Liste", () => {
    const store = new SignatureStore();
    const a = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>A</p>" });
    store.remove(a.id);
    expect(store.list(ACCOUNT_A)).toHaveLength(0);
  });

  it("Accounts sind isoliert: Default-Logik von Account A beeinflusst Account B nicht", () => {
    const store = new SignatureStore();
    store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>A1</p>" });
    const b1 = store.create({ mail_account_id: ACCOUNT_B, content_html: "<p>B1</p>" });

    expect(b1.is_default).toBe(true);
    expect(store.list(ACCOUNT_A)).toHaveLength(1);
    expect(store.list(ACCOUNT_B)).toHaveLength(1);
  });

  it("selectForNewMail / selectForReply spiegeln apply_to_new / apply_to_replies je Account", () => {
    const store = new SignatureStore();
    store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Privat</p>",
      apply_to_new: true,
      apply_to_replies: false,
    });
    const business = store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Business</p>",
      apply_to_new: false,
      apply_to_replies: true,
    });

    expect(store.selectForReply(ACCOUNT_A)?.id).toBe(business.id);
  });

  it("update mit is_default:true setzt Default-Invariante durch", () => {
    const store = new SignatureStore();
    const a = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>A</p>" });
    const b = store.create({ mail_account_id: ACCOUNT_A, content_html: "<p>B</p>" });

    store.update(b.id, { is_default: true });

    expect(store.get(a.id)?.is_default).toBe(false);
    expect(store.get(b.id)?.is_default).toBe(true);
  });
});
