// POST /accounts (Login/Registrierung) + POST /auth/session (Token-
// Erneuerung) — siehe api-spec.yaml. [2026-09-10] echte Auth
// (TERMINAL_INBOX.md 09.09.): bisher lief das gesamte Backend gegen einen
// fest verdrahteten Demo-User (ensureDemoUser() in db/store.ts), obwohl der
// Contract `security: bearerAuth` bereits seit 08.09. global vorschreibt.
//
// BEWUSST UNAUTHENTIFIZIERT (siehe app.ts-Mount-Reihenfolge, VOR
// requireAuth): das ist hier genau richtig, nicht vergessen -- ein Token
// kann naturgemäß nicht schon vorher verlangt werden, um überhaupt einen
// Token zu bekommen.
//
// BEWUSSTE GRENZE (kein Blocker, siehe backend/README.md "Auth"): echter
// Gmail-OAuth-Code-Austausch bzw. echte IMAP-Zugangsdaten-Prüfung sind noch
// nicht angebunden -- `oauthCode`/`imapPassword` werden aktuell nicht
// ausgewertet, nur `provider`/`emailAddress`. Analog zum bestehenden
// Fixture-Adapter-Muster für den Mail-Sync selbst (mail/fixtureAdapter.ts):
// funktioniert ohne jede Konfiguration, echte Provider-Anbindung ist ein
// späterer, separater Schritt.

import { Router } from "express";
import { createSystemFoldersForUser, store } from "../db/store";
import { toApiMailAccount } from "../mappers";
import type { Provider } from "../types";

export const authRouter = Router();

authRouter.post("/accounts", async (req, res) => {
  const body = req.body ?? {};
  const provider: Provider = body.provider === "imap" ? "imap" : "gmail";
  const emailAddress = typeof body.emailAddress === "string" ? body.emailAddress.trim() : "";
  if (!emailAddress) {
    return res.status(400).json({ error: "emailAddress ist erforderlich" });
  }

  let user = await store.getUserByEmail(emailAddress);
  if (!user) user = await store.createUser(emailAddress);

  // Kein Multi-Account pro User in diesem Entwicklungsstand (gleiche
  // 1:1-Annahme wie schon bei ensureDemoUser()/drafts.ts) -- ein zweiter
  // POST /accounts-Aufruf mit derselben E-Mail gibt einfach das bestehende
  // Konto zurück, statt ein zweites anzulegen.
  let account = await store.getMailAccountByUserId(user.id);
  if (!account) {
    account = await store.createMailAccount({
      userId: user.id,
      provider,
      emailAddress,
      encryptedOauthToken: null,
      encryptedImapCredentials: null,
      syncStatus: "pending",
      lastSyncedAt: null,
    });
  }

  if ((await store.listFolders(user.id)).length === 0) {
    await createSystemFoldersForUser(user.id);
  }

  const session = await store.createSession(user.id);
  res.status(200).json({ account: toApiMailAccount(account), token: session.token });
});

authRouter.post("/auth/session", async (req, res) => {
  const header = req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: "Authorization: Bearer <token> erforderlich" });
  }

  const refreshed = await store.refreshSession(token);
  if (!refreshed) {
    return res.status(401).json({ error: "Token ungültig oder abgelaufen" });
  }

  res.status(200).json({ token: refreshed.token });
});
