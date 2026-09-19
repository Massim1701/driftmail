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

export const mailProvidersRouter = Router();

// Gleiches Pfad-Muster wie postgresStore.ts SCHEMA_PATH: relativ zu diesem
// Modul, gilt gleichermaßen für src/routes/ (tsx/dev) und dist/routes/
// (nach npm run build), da beide gleich tief unter backend/ liegen.
const MAIL_PROVIDERS_PATH = join(__dirname, "../../../contracts/mail-providers.json");

// Einmalig beim Modul-Import geladen und geparst (statische Konfigurationsdatei,
// kein Grund, sie bei jedem Request erneut von der Platte zu lesen).
const mailProvidersJson = readFileSync(MAIL_PROVIDERS_PATH, "utf-8");
const mailProviders = JSON.parse(mailProvidersJson);

mailProvidersRouter.get("/mail-providers", (_req, res) => {
  res.json(mailProviders.providers);
});
