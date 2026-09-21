// /signatures, /signatures/{signatureId} — siehe api-spec.yaml.
//
// [2026-09-21] "Abwesenheitsassistent"-Auftrag (WEB_INBOX.md 21.09.): die
// `signatures`-Tabelle existierte seit dem allerersten Durchstich im
// Contract, wurde aber NIE vom echten Backend implementiert -- Track E
// baute die Auswahl-/Verwaltungslogik als eigenstaendiges `mail-actions`-
// Package (selectSignatureForContext/appendSignature/Invariante "höchstens
// ein Default pro Konto"), das nie an backend/ angebunden wurde. Diese
// Route nutzt echte Persistenz (siehe db/store.ts), die Invariante wird
// dort nachgebildet -- @driftmail/mail-actions selbst wird hier bewusst
// NICHT importiert (das Package ist reine In-Memory-Logik ohne DB-Anschluss,
// siehe SignatureStore-Kommentar dort), aber vom Abwesenheitsassistenten
// (mail/absenceResponder.ts) fuer appendSignature() genutzt.

import { Router } from "express";
import { store } from "../db/store";
import { toApiSignature } from "../mappers";

export const signaturesRouter = Router();

async function requireOwnAccount(userId: string, accountId: string): Promise<boolean> {
  const account = await store.getMailAccount(accountId);
  return !!account && account.userId === userId;
}

signaturesRouter.get("/signatures", async (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (accountId) {
    if (!(await requireOwnAccount(req.userId, accountId))) {
      return res.status(403).json({ error: "Mail-Konto gehört nicht zum angemeldeten User" });
    }
    return res.json((await store.listSignatures(accountId)).map(toApiSignature));
  }

  const accounts = await store.listMailAccountsByUserId(req.userId);
  const perAccount = await Promise.all(accounts.map((a) => store.listSignatures(a.id)));
  res.json(perAccount.flat().map(toApiSignature));
});

signaturesRouter.post("/signatures", async (req, res) => {
  const body = req.body as { mailAccountId?: string; contentHtml?: string; isDefault?: boolean; applyToNew?: boolean; applyToReplies?: boolean };
  if (!body.mailAccountId || typeof body.contentHtml !== "string" || !body.contentHtml.trim()) {
    return res.status(400).json({ error: "mailAccountId und contentHtml sind erforderlich" });
  }
  if (!(await requireOwnAccount(req.userId, body.mailAccountId))) {
    return res.status(403).json({ error: "Mail-Konto gehört nicht zum angemeldeten User" });
  }

  const created = await store.createSignature({
    mailAccountId: body.mailAccountId,
    contentHtml: body.contentHtml,
    isDefault: body.isDefault ?? false,
    applyToNew: body.applyToNew ?? true,
    applyToReplies: body.applyToReplies ?? false,
  });
  res.status(201).json(toApiSignature(created));
});

async function requireOwnSignature(userId: string, signatureId: string) {
  const signature = await store.getSignature(signatureId);
  if (!signature) return { signature: null, status: 404 as const };
  if (!(await requireOwnAccount(userId, signature.mailAccountId))) return { signature: null, status: 403 as const };
  return { signature, status: 200 as const };
}

signaturesRouter.patch("/signatures/:signatureId", async (req, res) => {
  const { signature, status } = await requireOwnSignature(req.userId, req.params.signatureId);
  if (!signature) return res.status(status).json({ error: status === 404 ? "Signatur nicht gefunden" : "Signatur gehört nicht zum angemeldeten User" });

  const body = req.body as { contentHtml?: string; isDefault?: boolean; applyToNew?: boolean; applyToReplies?: boolean };
  const updated = await store.updateSignature(signature.id, body);
  res.json(toApiSignature(updated!));
});

signaturesRouter.delete("/signatures/:signatureId", async (req, res) => {
  const { signature, status } = await requireOwnSignature(req.userId, req.params.signatureId);
  if (!signature) return res.status(status).json({ error: status === 404 ? "Signatur nicht gefunden" : "Signatur gehört nicht zum angemeldeten User" });

  await store.deleteSignature(signature.id);
  res.status(204).end();
});
