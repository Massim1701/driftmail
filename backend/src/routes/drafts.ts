import { Router } from "express";
import { store, ensureDemoUser } from "../db/store";
import { toApiDraft } from "../mappers";

export const draftsRouter = Router();

// GET /drafts — siehe api-spec.yaml (WEB_INBOX.md 09.09. "KORREKTUR/
// ERWEITERUNG des Ordner-Umbau-Eintrags"). Der "entwuerfe"-Systemordner in
// der UI zeigt den Inhalt dieser Route, nicht GET /messages.
draftsRouter.get("/drafts", async (_req, res) => {
  const { user } = await ensureDemoUser();
  const drafts = await store.listDrafts(user.id);
  res.json(drafts.map(toApiDraft));
});

// POST /drafts — legt einen neuen (leeren oder vorbefüllten) Entwurf an.
// Anders als POST /messages/send (dort accountId ODER inReplyToMessageId
// erforderlich) reicht hier immer der Demo-User selbst -- dieser Skeleton
// kennt ohnehin nur ein einziges Konto pro User (ensureDemoUser()), ein
// eigenes accountId-Feld im Request waere hier redundant.
draftsRouter.post("/drafts", async (req, res) => {
  const body = req.body ?? {};
  const { user, account } = await ensureDemoUser();

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

  const draft = await store.createDraft({
    userId: user.id,
    mailAccountId: account.id,
    inReplyToMessageId,
    toAddresses,
    ccAddresses,
    subject: typeof body.subject === "string" ? body.subject : null,
    bodyText: typeof body.bodyText === "string" ? body.bodyText : null,
  });
  res.status(200).json(toApiDraft(draft));
});

// PATCH /drafts/{draftId} — laufendes Speichern während des Tippens.
draftsRouter.patch("/drafts/:draftId", async (req, res) => {
  const existing = await store.getDraft(req.params.draftId);
  if (!existing) return res.status(404).json({ error: "Entwurf nicht gefunden" });

  const body = req.body ?? {};
  const patch: Parameters<typeof store.updateDraft>[1] = {};
  if (Array.isArray(body.to)) {
    patch.toAddresses = body.to.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (Array.isArray(body.cc)) {
    patch.ccAddresses = body.cc.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (typeof body.subject === "string") patch.subject = body.subject;
  if (typeof body.bodyText === "string") patch.bodyText = body.bodyText;

  const updated = (await store.updateDraft(existing.id, patch))!;
  res.json(toApiDraft(updated));
});

// DELETE /drafts/{draftId} — Entwurf verwerfen. Wird auch intern von
// POST /messages/send aufgerufen (siehe routes/messages.ts), wenn dort
// draftId mitgegeben wurde.
draftsRouter.delete("/drafts/:draftId", async (req, res) => {
  const deleted = await store.deleteDraft(req.params.draftId);
  if (!deleted) return res.status(404).json({ error: "Entwurf nicht gefunden" });
  res.status(200).json({ deleted: true });
});
