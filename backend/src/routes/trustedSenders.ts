// Whitelist vertrauenswürdiger Absender (WEB_INBOX.md 15.09., "Whitelist
// für vertrauenswürdige Absender") — siehe api-spec.yaml /trusted-senders,
// /trusted-senders/{trustedSenderId}. Bewusste User-Entscheidung, keine
// automatische Klassifikation; Wirkung auf künftige Mail in mail/sync.ts.

import { Router } from "express";
import { store } from "../db/store";
import { toApiTrustedSender } from "../mappers";

export const trustedSendersRouter = Router();

// GET /trusted-senders — siehe api-spec.yaml
trustedSendersRouter.get("/trusted-senders", async (req, res) => {
  res.json((await store.listTrustedSenders(req.userId)).map(toApiTrustedSender));
});

// POST /trusted-senders — idempotent (find-or-create nach userId+senderAddress,
// siehe store.createTrustedSender()), deshalb 201 auch bei bereits
// vorhandenem Eintrag statt eines Konflikts.
trustedSendersRouter.post("/trusted-senders", async (req, res) => {
  const senderAddress = typeof req.body?.senderAddress === "string" ? req.body.senderAddress.trim() : "";
  if (!senderAddress) return res.status(400).json({ error: "senderAddress ist erforderlich" });

  const trustedSender = await store.createTrustedSender({ userId: req.userId, senderAddress });
  res.status(201).json(toApiTrustedSender(trustedSender));
});

// DELETE /trusted-senders/:trustedSenderId — eigenen Whitelist-Eintrag entfernen
trustedSendersRouter.delete("/trusted-senders/:trustedSenderId", async (req, res) => {
  const trustedSender = await store.getTrustedSender(req.params.trustedSenderId);
  if (!trustedSender) return res.status(404).json({ error: "Eintrag nicht gefunden" });
  // Besitz-Prüfung, analog zu routes/folders.ts.
  if (trustedSender.userId !== req.userId) {
    return res.status(403).json({ error: "Eintrag gehört nicht zum angemeldeten User" });
  }

  await store.deleteTrustedSender(trustedSender.id);
  res.status(204).send();
});
