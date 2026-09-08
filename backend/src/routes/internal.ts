// Endpunkte außerhalb von api-spec.yaml — reine Betriebs-/Test-Hilfsmittel
// für diesen ersten Durchstich, kein Contract-Bestandteil. Andere Tracks
// sollten sich NICHT auf diese Pfade verlassen.

import { Router } from "express";
import { store, ensureDemoUser } from "../db/store";
import { syncAccount } from "../mail/sync";
import { aiAdapter } from "../ai";

export const internalRouter = Router();

internalRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", messages: store.messages.length, accounts: store.mailAccounts.length });
});

// POST /internal/sync[?accountId=...] — stößt einen Mail-Sync an (Fixture-
// oder echter Adapter, je nach Env-Konfiguration, siehe mail/sync.ts).
internalRouter.post("/internal/sync", async (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const accounts = accountId
    ? store.listMailAccounts().filter((a) => a.id === accountId)
    : store.listMailAccounts();

  if (accounts.length === 0) {
    return res.status(404).json({ error: "kein passendes mail_account gefunden" });
  }

  const results = [];
  for (const account of accounts) {
    try {
      const { imported } = await syncAccount(account, aiAdapter);
      results.push({ accountId: account.id, imported, syncStatus: account.syncStatus });
    } catch (err) {
      results.push({ accountId: account.id, error: String(err), syncStatus: account.syncStatus });
    }
  }

  res.json({ results });
});

// POST /internal/seed — legt (falls nicht vorhanden) einen Demo-User +
// Demo-Konto an. Wird auch beim Serverstart automatisch aufgerufen.
internalRouter.post("/internal/seed", (_req, res) => {
  const { user, account } = ensureDemoUser();
  res.json({ user, account });
});
