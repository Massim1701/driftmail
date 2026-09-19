// POST /accounts (Login/Registrierung, provider=imap bzw. Fallback ohne
// Google-OAuth-Konfiguration) + GET /auth/google/start + GET
// /auth/google/callback (echter Gmail-Login) + POST /auth/session (Token-
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
// [2026-09-10] WEB_INBOX.md "Antwort auf die zwei Fragen zu Auth": echter
// Gmail-OAuth-Flow (Server-seitiger Redirect-Flow, kein clientseitiger
// Code-Austausch -- einfacher, kein OAuth-Client-Secret im Browser) plus
// Allowlist-Pruefung (auth/allowlist.ts) bei JEDER Stelle, an der ein neuer
// User entstehen kann. `POST /accounts` bleibt daneben bestehen für
// provider=imap (dort gibt es weiterhin keinen echten Zugangsdaten-Check,
// bewusste, unveraenderte Grenze, siehe backend/README.md "Auth") und als
// Fallback, falls Google-OAuth nicht konfiguriert ist (Zero-Config-Muster
// wie beim Gmail-Sync-Adapter selbst) -- unterliegt jetzt aber ebenfalls der
// Allowlist, sonst waere sie nur eine halbe Absicherung.

import { Router } from "express";
import { google } from "googleapis";
import { isEmailAllowed } from "../auth/allowlist";
import { encryptCredentials } from "../auth/credentialsEncryption";
import { createSystemFoldersForUser, store } from "../db/store";
import { ImapAdapter, type ImapCredentials } from "../mail/imapAdapter";
import { toApiMailAccount } from "../mappers";
import type { Provider } from "../types";

export const authRouter = Router();

// Scopes wie in der urspruenglichen Rueckfrage angekuendigt (WEB_INBOX.md):
// `openid`/`email`/`profile` fuer die verifizierte Identitaet (Login),
// `gmail.readonly`/`gmail.modify` fuer den bestehenden Sync
// (mail/gmailAdapter.ts), `gmail.send` fuer POST /messages/send.
const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI);
}

// Selber OAuth-Client wie der geplante echte Gmail-Sync (mail/gmailAdapter.ts)
// -- ein Google-Cloud-Projekt/-Client fuer beides, siehe Kopfkommentar.
function buildGoogleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? "http://localhost:5173";
}

authRouter.get("/auth/google/start", (req, res) => {
  if (!googleOAuthConfigured()) {
    return res
      .status(503)
      .json({ error: "Google-OAuth ist nicht konfiguriert (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GOOGLE_OAUTH_REDIRECT_URI fehlen)" });
  }
  const client = buildGoogleOAuthClient();
  const url = client.generateAuthUrl({
    // "offline" + "consent" erzwingen ein refresh_token bei JEDEM Login,
    // nicht nur beim allerersten Consent -- ohne "consent" liefert Google
    // bei einer bereits erteilten Zustimmung kein refresh_token erneut,
    // was den spaeteren echten Mail-Sync fuer dieses Konto ohne manuelles
    // Zuruecksetzen im Google-Konto verhindern wuerde.
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES,
  });
  res.redirect(url);
});

authRouter.get("/auth/google/callback", async (req, res) => {
  const redirectWithError = (reason: string) => res.redirect(`${frontendUrl()}/auth/callback?error=${encodeURIComponent(reason)}`);

  if (!googleOAuthConfigured()) {
    return redirectWithError("oauth_not_configured");
  }
  const code = typeof req.query.code === "string" ? req.query.code : null;
  if (!code) {
    return redirectWithError("missing_code");
  }

  const client = buildGoogleOAuthClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (err) {
    console.error("[auth] Google-Token-Austausch fehlgeschlagen:", err);
    return redirectWithError("token_exchange_failed");
  }
  client.setCredentials(tokens);

  // Verifizierte E-Mail-Adresse kommt aus Googles eigenem Userinfo-Endpoint
  // (auf Basis des soeben erhaltenen Access-Tokens) -- NIE vom Client
  // vertrauen (gleiches Prinzip wie userId serverseitig aus dem Session-
  // Token, nicht aus Body/Query/Pfad, siehe middleware/auth.ts).
  let email: string | null | undefined;
  let emailVerified: boolean | null | undefined;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    email = data.email;
    emailVerified = data.verified_email;
  } catch (err) {
    console.error("[auth] Google-Userinfo-Abruf fehlgeschlagen:", err);
    return redirectWithError("userinfo_failed");
  }
  if (!email || emailVerified === false) {
    return redirectWithError("email_not_verified");
  }
  if (!isEmailAllowed(email)) {
    return redirectWithError("not_allowlisted");
  }

  let user = await store.getUserByEmail(email);
  if (!user) user = await store.createUser(email);

  // [2026-09-19] Fund: die Spalte heisst "encrypted_oauth_token", enthielt
  // aber bisher den rohen Refresh-Token unverschluesselt -- der Spaltenname
  // versprach etwas, das der Code nicht einhielt (siehe
  // auth/credentialsEncryption.ts Kopfkommentar). Ab hier echt verschluesselt.
  const encryptedRefreshToken = tokens.refresh_token ? encryptCredentials(tokens.refresh_token) : null;

  let account = await store.getMailAccountByUserId(user.id);
  if (!account) {
    account = await store.createMailAccount({
      userId: user.id,
      provider: "gmail",
      emailAddress: email,
      encryptedOauthToken: encryptedRefreshToken,
      encryptedImapCredentials: null,
      syncStatus: "pending",
      lastSyncedAt: null,
    });
  } else if (encryptedRefreshToken) {
    // Google liefert ein refresh_token nur bei "prompt=consent" (s.o.) --
    // bei erneutem Login trotzdem immer den neuesten Stand übernehmen.
    account = (await store.updateMailAccount(account.id, { encryptedOauthToken: encryptedRefreshToken })) ?? account;
  }

  if ((await store.listFolders(user.id)).length === 0) {
    await createSystemFoldersForUser(user.id);
  }

  const session = await store.createSession(user.id);
  res.redirect(`${frontendUrl()}/auth/callback?token=${encodeURIComponent(session.token)}`);
});

authRouter.post("/accounts", async (req, res) => {
  const body = req.body ?? {};
  const provider: Provider = body.provider === "imap" ? "imap" : "gmail";
  const emailAddress = typeof body.emailAddress === "string" ? body.emailAddress.trim() : "";
  if (!emailAddress) {
    return res.status(400).json({ error: "emailAddress ist erforderlich" });
  }
  if (!isEmailAllowed(emailAddress)) {
    return res.status(403).json({ error: "Diese E-Mail-Adresse ist fuer driftmail (noch) nicht freigeschaltet." });
  }

  let user = await store.getUserByEmail(emailAddress);
  if (!user) user = await store.createUser(emailAddress);

  // Kein Multi-Account pro User in diesem Entwicklungsstand (gleiche
  // 1:1-Annahme wie schon bei ensureDemoUser()/drafts.ts) -- ein zweiter
  // POST /accounts-Aufruf mit derselben E-Mail gibt einfach das bestehende
  // Konto zurück, statt ein zweites anzulegen. Gilt auch fuer IMAP: ein
  // zweiter Aufruf mit (ggf. geaenderten) IMAP-Feldern aendert die bereits
  // gespeicherten Zugangsdaten NICHT -- kein Update-Pfad in diesem Schritt,
  // siehe api-spec.yaml-Summary/backend/README.md.
  let account = await store.getMailAccountByUserId(user.id);
  if (!account) {
    let encryptedImapCredentials: string | null = null;

    if (provider === "imap") {
      const imapHost = typeof body.imapHost === "string" ? body.imapHost.trim() : "";
      const imapPassword = typeof body.imapPassword === "string" ? body.imapPassword : "";
      if (!imapHost || !imapPassword) {
        return res.status(400).json({ error: "imapHost und imapPassword sind fuer provider=imap erforderlich" });
      }
      const imapPort = typeof body.imapPort === "number" ? body.imapPort : 993;
      const imapSecure = typeof body.imapSecure === "boolean" ? body.imapSecure : true;
      const imapUser = typeof body.imapUser === "string" && body.imapUser.trim() ? body.imapUser.trim() : emailAddress;
      // SMTP-Fallback: gleiches Verhalten wie der bestehende Env-Var-Pfad
      // in mail/sync.ts adapterForAccount() -- IMAP-Host + Port 587
      // (STARTTLS), falls nicht explizit angegeben.
      const smtpHost = typeof body.smtpHost === "string" && body.smtpHost.trim() ? body.smtpHost.trim() : imapHost;
      const smtpPort = typeof body.smtpPort === "number" ? body.smtpPort : 587;
      const smtpSecure = typeof body.smtpSecure === "boolean" ? body.smtpSecure : false;

      const credentials: ImapCredentials = {
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        user: imapUser,
        password: imapPassword,
        smtpHost,
        smtpPort,
        smtpSecure,
      };

      // Echter Verbindungstest VOR dem Speichern (WEB_INBOX.md 15.09.,
      // "ECHTE LUECKE ENTDECKT") -- kein Platzhalter mehr: falsche/
      // abgelaufene Zugangsdaten werden sofort abgelehnt statt still
      // gespeichert und erst beim naechsten Sync-Versuch zu scheitern.
      try {
        await new ImapAdapter(credentials).testConnection();
      } catch (err) {
        console.error(`[auth] IMAP-Verbindungstest fehlgeschlagen fuer ${imapHost}:`, err);
        return res.status(422).json({
          error: "IMAP-Zugangsdaten konnten nicht verifiziert werden -- bitte Host, Adresse und (App-)Passwort prüfen.",
        });
      }

      encryptedImapCredentials = encryptCredentials(JSON.stringify(credentials));
    }

    account = await store.createMailAccount({
      userId: user.id,
      provider,
      emailAddress,
      encryptedOauthToken: null,
      encryptedImapCredentials,
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
