import { Router } from "express";
import { store } from "../db/store";
import { toApiDraft } from "../mappers";

export const draftsRouter = Router();

// GET /drafts — siehe api-spec.yaml (WEB_INBOX.md 09.09. "KORREKTUR/
// ERWEITERUNG des Ordner-Umbau-Eintrags"). Der "entwuerfe"-Systemordner in
// der UI zeigt den Inhalt dieser Route, nicht GET /messages.
draftsRouter.get("/drafts", async (req, res) => {
  const drafts = await store.listDrafts(req.userId);
  res.json(drafts.map(toApiDraft));
});

// POST /drafts — legt einen neuen (leeren oder vorbefüllten) Entwurf an.
// Anders als POST /messages/send (dort accountId ODER inReplyToMessageId
// erforderlich) reicht hier immer der angemeldete User selbst -- dieser
// Skeleton kennt ohnehin nur ein einziges Konto pro User, ein eigenes
// accountId-Feld im Request waere hier redundant.
draftsRouter.post("/drafts", async (req, res) => {
  const body = req.body ?? {};
  const account = await store.getMailAccountByUserId(req.userId);
  if (!account) return res.status(400).json({ error: "kein Mail-Konto für diesen User verbunden" });

  const inReplyToMessageId = typeof body.inReplyToMessageId === "string" ? body.inReplyToMessageId : null;
  if (inReplyToMessageId && !(await store.getMessage(inReplyToMessageId))) {
    return res.status(404).json({ error: "inReplyToMessageId: Nachricht nicht gefunden" });
  }

  const toAddresses: string[] = Array.isArray(body.to)
    ? body.to.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const ccAddresses: string[] = Array.isArray(body.cc)
    ? body.cc.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const bccAddresses: string[] = Array.isArray(body.bcc)
    ? body.bcc.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const subject = typeof body.subject === "string" ? body.subject : null;
  const bodyText = typeof body.bodyText === "string" ? body.bodyText : null;

  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send"): hier bei
  // POST (Neuanlage) ist "Feld fehlt" und "Feld ist null" gleichbedeutend
  // (kein Scheduling) -- anders als bei PATCH unten, wo "fehlt" "unveraendert
  // lassen" bedeutet, siehe dortigen Kommentar.
  let scheduledFor: string | null = null;
  if (body.scheduledFor !== undefined && body.scheduledFor !== null) {
    const parsed = parseFutureTimestamp(body.scheduledFor);
    if (!parsed) return res.status(400).json({ error: "scheduledFor muss ein gueltiger, in der Zukunft liegender Zeitpunkt sein" });
    scheduledFor = parsed;
  }
  if (scheduledFor && (toAddresses.length === 0 || !bodyText?.trim())) {
    return res.status(400).json({ error: "scheduledFor verlangt mindestens einen Empfaenger und bodyText" });
  }

  const draft = await store.createDraft({
    userId: req.userId,
    mailAccountId: account.id,
    inReplyToMessageId,
    toAddresses,
    ccAddresses,
    bccAddresses,
    subject,
    bodyText,
    scheduledFor,
  });
  res.status(200).json(toApiDraft(draft));
});

/** `undefined`/ungueltiges Format -> null (kein gueltiger Zeitpunkt), sonst
 * der ISO-String, aber nur wenn er wirklich in der Zukunft liegt. */
function parseFutureTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;
  return parsed.toISOString();
}

// PATCH /drafts/{draftId} — laufendes Speichern während des Tippens.
draftsRouter.patch("/drafts/:draftId", async (req, res) => {
  const existing = await store.getDraft(req.params.draftId);
  if (!existing) return res.status(404).json({ error: "Entwurf nicht gefunden" });
  if (existing.userId !== req.userId) return res.status(403).json({ error: "Entwurf gehört nicht zum angemeldeten User" });

  const body = req.body ?? {};
  const patch: Parameters<typeof store.updateDraft>[1] = {};
  if (Array.isArray(body.to)) {
    patch.toAddresses = body.to.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (Array.isArray(body.cc)) {
    patch.ccAddresses = body.cc.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (Array.isArray(body.bcc)) {
    patch.bccAddresses = body.bcc.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (typeof body.subject === "string") patch.subject = body.subject;
  if (typeof body.bodyText === "string") patch.bodyText = body.bodyText;

  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send"): das Feld
  // FEHLT im Body -> unveraendert lassen (normaler Autosave-PATCH ohne
  // Bezug zur Planung). `scheduledFor: null` im Body -> Planung explizit
  // aufheben. Ein String-Wert muss gueltig+zukuenftig sein, sonst 400.
  if ("scheduledFor" in body) {
    if (body.scheduledFor === null) {
      patch.scheduledFor = null;
    } else {
      const parsed = parseFutureTimestamp(body.scheduledFor);
      if (!parsed) return res.status(400).json({ error: "scheduledFor muss ein gueltiger, in der Zukunft liegender Zeitpunkt sein" });
      patch.scheduledFor = parsed;
    }
  }

  const updated = (await store.updateDraft(existing.id, patch))!;
  res.json(toApiDraft(updated));
});

// DELETE /drafts/{draftId} — Entwurf verwerfen. Wird auch intern von
// POST /messages/send aufgerufen (siehe routes/messages.ts), wenn dort
// draftId mitgegeben wurde.
draftsRouter.delete("/drafts/:draftId", async (req, res) => {
  const existing = await store.getDraft(req.params.draftId);
  if (!existing) return res.status(404).json({ error: "Entwurf nicht gefunden" });
  if (existing.userId !== req.userId) return res.status(403).json({ error: "Entwurf gehört nicht zum angemeldeten User" });

  await store.deleteDraft(existing.id);
  res.status(200).json({ deleted: true });
});
