import { Router } from "express";
import { store } from "../db/store";
import { toApiMailAccount } from "../mappers";
import { syncAccount } from "../mail/sync";
import { aiAdapter } from "../ai";

export const accountsRouter = Router();

// GET /accounts — siehe api-spec.yaml. [2026-09-10] echte Auth: nur die
// Konten des angemeldeten Users (req.userId, von requireAuth aufgelöst) --
// vorher lieferte das ungefiltert ALLE mail_accounts über alle User hinweg,
// weil es bis dahin ohnehin nur den einen Demo-User gab.
accountsRouter.get("/accounts", async (req, res) => {
  const accounts = (await store.listMailAccounts()).filter((a) => a.userId === req.userId);
  res.json(accounts.map(toApiMailAccount));
});

// POST /accounts/{accountId}/sync (WEB_INBOX.md 21.09. "SEHR WICHTIGE
// LUECKE - HOECHSTE PRIORITAET", Punkt 1: manueller Mail-Abruf) -- stößt
// denselben `syncAccount()` an, den auch der periodische Hintergrund-Sync
// (mail/scheduler.ts) und der initiale Sync beim Verbinden nutzen, für
// GENAU EIN Konto, sofort statt beim nächsten Intervall. Ownership-Check
// wie bei jedem anderen Endpunkt hier -- ein Sync-Trigger für ein fremdes
// Konto darf nicht möglich sein, auch wenn die accountId erraten würde.
accountsRouter.post("/accounts/:accountId/sync", async (req, res) => {
  const account = await store.getMailAccount(req.params.accountId);
  if (!account || account.userId !== req.userId) {
    return res.status(404).json({ error: "Mail-Konto nicht gefunden" });
  }
  try {
    const { imported, autoDeleted } = await syncAccount(account, aiAdapter);
    res.json({ imported, autoDeleted, syncStatus: account.syncStatus });
  } catch (err) {
    console.error(`[sync] Manueller Sync fehlgeschlagen fuer Konto ${account.emailAddress}:`, err);
    res.status(502).json({ error: "Sync fehlgeschlagen -- Mail-Server evtl. nicht erreichbar." });
  }
});

// DELETE /accounts/{accountId} (WEB_INBOX.md 21.09. "NEUER AUFTRAG -
// Einstellungsbereich + Info-Seite", Punkt 1 "Konten-Verwaltung"):
// entfernt ein verbundenes Konto -- ownership-geprueft wie der Sync-
// Endpunkt oben. 400, wenn es das letzte Konto des Users waere: die
// gesamte Auth funktioniert aktuell "implizit ueber Mail-Konto-
// Verbindung" (siehe backend/README.md "Auth"), ein User ohne jedes Konto
// haette keinen sinnvollen Weg mehr, sich je wieder anzumelden.
accountsRouter.delete("/accounts/:accountId", async (req, res) => {
  const account = await store.getMailAccount(req.params.accountId);
  if (!account || account.userId !== req.userId) {
    return res.status(404).json({ error: "Mail-Konto nicht gefunden" });
  }
  const ownAccounts = await store.listMailAccountsByUserId(req.userId);
  if (ownAccounts.length <= 1) {
    return res.status(400).json({ error: "Das letzte verbundene Konto kann nicht entfernt werden." });
  }
  await store.deleteMailAccount(account.id);
  res.status(204).end();
});
