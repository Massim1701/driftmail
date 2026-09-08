import { describe, expect, it } from "vitest";
import { composeReplyDraft, draftReply } from "../src/draftReply";
import { SignatureStore } from "../src/signatures";
import type { MailThread } from "../src/types";

const ACCOUNT_A = "11111111-1111-1111-1111-111111111111";

function thread(messages: MailThread["messages"]): MailThread {
  return { messages };
}

describe("draftReply (Platzhalter-Template)", () => {
  it("erzeugt einen nicht-leeren String-Entwurf (Promise<string> laut Contract)", async () => {
    const t = thread([
      {
        fromAddress: "jane.doe@example.com",
        subject: "Rückfrage zu Ihrem Angebot",
        bodyText: "Können Sie mir mehr Details schicken?",
        receivedAt: "2026-09-08T10:00:00Z",
      },
    ]);

    const draft = await draftReply(t);
    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
  });

  it("greift den Betreff der letzten Nachricht im Thread auf", async () => {
    const t = thread([
      {
        fromAddress: "a@example.com",
        subject: "Erste Nachricht",
        bodyText: "...",
        receivedAt: "2026-09-01T10:00:00Z",
      },
      {
        fromAddress: "b@example.com",
        subject: "Zweite Nachricht - das Thema",
        bodyText: "...",
        receivedAt: "2026-09-02T10:00:00Z",
      },
    ]);

    const draft = await draftReply(t);
    expect(draft).toContain("Zweite Nachricht - das Thema");
    expect(draft).not.toContain("Erste Nachricht");
  });

  it("leitet einen groben Anrede-Namen aus der Absenderadresse der letzten Nachricht ab", async () => {
    const t = thread([
      {
        fromAddress: "max.mustermann@example.com",
        subject: "Betreff",
        bodyText: "...",
        receivedAt: "2026-09-08T10:00:00Z",
      },
    ]);

    const draft = await draftReply(t);
    expect(draft).toContain("Hallo Max Mustermann,");
  });

  it("fällt bei nicht auswertbarer Adresse auf generische Anrede zurück", async () => {
    const t = thread([
      {
        fromAddress: "@example.com",
        subject: "Betreff",
        bodyText: "...",
        receivedAt: "2026-09-08T10:00:00Z",
      },
    ]);

    const draft = await draftReply(t);
    expect(draft.startsWith("Hallo,")).toBe(true);
  });

  it("liefert einen sinnvollen Fallback-Text für einen leeren Thread, statt zu werfen", async () => {
    const draft = await draftReply(thread([]));
    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
  });

  it("enthält eine klar markierte Platzhalter-Stelle für spätere echte KI-Generierung", async () => {
    const t = thread([
      {
        fromAddress: "a@example.com",
        subject: "X",
        bodyText: "...",
        receivedAt: "2026-09-08T10:00:00Z",
      },
    ]);
    const draft = await draftReply(t);
    expect(draft).toContain("Platzhalter-Entwurf");
  });
});

describe("composeReplyDraft (draftReply + Signatur-Anhang, Integrations-Helfer)", () => {
  const t = thread([
    {
      fromAddress: "kunde@example.com",
      subject: "Frage",
      bodyText: "...",
      receivedAt: "2026-09-08T10:00:00Z",
    },
  ]);

  it("hängt die für Antworten freigeschaltete Signatur an", async () => {
    const store = new SignatureStore();
    const replySig = store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Viele Grüße, Support-Team</p>",
      apply_to_new: false,
      apply_to_replies: true,
    });

    const result = await composeReplyDraft(t, ACCOUNT_A, store.list(ACCOUNT_A));

    expect(result).toContain("Platzhalter-Entwurf");
    expect(result).toContain(replySig.content_html);
  });

  it("hängt keine Signatur an, wenn keine für Antworten freigeschaltet ist", async () => {
    const store = new SignatureStore();
    store.create({
      mail_account_id: ACCOUNT_A,
      content_html: "<p>Nur für neue Mails</p>",
      apply_to_new: true,
      apply_to_replies: false,
    });

    const result = await composeReplyDraft(t, ACCOUNT_A, store.list(ACCOUNT_A));
    expect(result).not.toContain("Nur für neue Mails");
  });
});
