// GET /mail-providers — siehe api-spec.yaml (WEB_INBOX.md 15.09., "ECHTE
// LUECKE ENTDECKT: Provider-Auswahl im Onboarding"). Liefert
// contracts/mail-providers.json unverändert aus, damit Track C/F (sobald
// gebaut) Provider-Presets aus EINER Quelle bezieht, statt sie pro
// Plattform hart zu codieren (gleiches Prinzip wie design-tokens.json).
// BEWUSST UNAUTHENTIFIZIERT (siehe app.ts-Mount-Reihenfolge, vor
// requireAuth): der Onboarding-Provider-Auswahlbildschirm läuft VOR jedem
// Login, es gibt an dieser Stelle noch keinen Bearer-Token.

import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverMailSettings, isValidDomain } from "../mail/autodiscover";
import { googleOAuthConfigured } from "./auth";

export const mailProvidersRouter = Router();

// Gleiches Pfad-Muster wie postgresStore.ts SCHEMA_PATH: relativ zu diesem
// Modul, gilt gleichermaßen für src/routes/ (tsx/dev) und dist/routes/
// (nach npm run build), da beide gleich tief unter backend/ liegen.
const MAIL_PROVIDERS_PATH = join(__dirname, "../../../contracts/mail-providers.json");

// Einmalig beim Modul-Import geladen und geparst (statische Konfigurationsdatei,
// kein Grund, sie bei jedem Request erneut von der Platte zu lesen).
const mailProvidersJson = readFileSync(MAIL_PROVIDERS_PATH, "utf-8");
const mailProviders = JSON.parse(mailProvidersJson);

// [2026-09-28] `oauthAvailable`: ob der OAuth-Weg auf DIESEM Server
// eingerichtet ist (Gmail: GMAIL_CLIENT_ID/_SECRET + Redirect-URI gesetzt).
// Ohne diese Angabe hing der Gmail-Login auf Servern ohne Google-Projekt an
// einem 503 -- jetzt schicken die Clients Gmail dann direkt in den IMAP-Weg
// mit App-Passwort.
mailProvidersRouter.get("/mail-providers", (_req, res) => {
  res.json(
    mailProviders.providers.map((p: { id: string; authType: string }) => ({
      ...p,
      oauthAvailable: p.authType === "oauth" && p.id === "gmail" && googleOAuthConfigured(),
    })),
  );
});

// [2026-09-28] GET /mail-providers/discover?domain=... -- siehe
// mail/autodiscover.ts. Ebenfalls vor dem Login erreichbar (Onboarding),
// deshalb mit einfacher Bremse je IP: jede Anfrage loest DNS-/ISPDB-Abfragen
// aus.
const DISCOVER_LIMIT_PER_MINUTE = 30;
const discoverHits = new Map<string, { count: number; windowStart: number }>();

mailProvidersRouter.get("/mail-providers/discover", async (req, res) => {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = discoverHits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    if (discoverHits.size > 10_000) discoverHits.clear();
    discoverHits.set(ip, { count: 1, windowStart: now });
  } else if (++entry.count > DISCOVER_LIMIT_PER_MINUTE) {
    return res.status(429).json({ error: "Zu viele Anfragen, bitte kurz warten." });
  }

  const domain = typeof req.query.domain === "string" ? req.query.domain.trim().toLowerCase() : "";
  if (!isValidDomain(domain)) {
    return res.status(400).json({ error: "ungültige Domain" });
  }
  res.json(await discoverMailSettings(domain));
});
