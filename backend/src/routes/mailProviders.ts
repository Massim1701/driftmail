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
import { MAIL_PORTS, probeMailServer } from "../mail/probe";
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
//
// [2026-09-28] Einrichtungsschritte in der Sprache des Geraets: Massimo
// "die Beschreibung, wie man das mit Gmail macht, auf Deutsch und in
// anderen Sprachen, einfach". Uebersetzungen stehen je Anbieter unter
// `i18n.<sprache>` in mail-providers.json (setupHint/setupSteps/
// setupLinkLabel); Deutsch ist der Standard auf oberster Ebene. Sprache aus
// `?lang=` oder dem Accept-Language-Header (Browser schicken ihn von
// selbst, die iOS-App setzt ihn); fehlt die Uebersetzung, Englisch, ohne
// jede Angabe Deutsch. `i18n` selbst geht nicht
// an die Clients.
type ProviderJson = { id: string; authType: string; i18n?: Record<string, Record<string, unknown>> };

export function pickLanguage(query: unknown, acceptLanguage: string | undefined, available: Set<string>): string | null {
  const wanted = [
    ...(typeof query === "string" ? [query] : []),
    ...(acceptLanguage ?? "")
      .split(",")
      .map((part) => {
        const [tag, q] = part.trim().split(";q=");
        return { tag: tag.toLowerCase(), q: q === undefined ? 1 : Number(q) };
      })
      // "*" (z.B. von Node/curl) heisst "egal" -- wie keine Angabe behandeln.
      .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
      .sort((a, b) => b.q - a.q)
      .map((x) => x.tag),
  ];
  for (const tag of wanted) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "de") return null; // Deutsch = Standard
    if (available.has(base)) return base;
  }
  // Andere Sprache ohne Uebersetzung (z.B. Polnisch): Englisch versteht
  // man eher als Deutsch. Ohne jede Angabe bleibt es bei Deutsch.
  return wanted.length > 0 && available.has("en") ? "en" : null;
}

mailProvidersRouter.get("/mail-providers", (req, res) => {
  res.json(
    mailProviders.providers.map(({ i18n, ...p }: ProviderJson) => {
      const lang = i18n ? pickLanguage(req.query.lang, req.header("accept-language"), new Set(Object.keys(i18n))) : null;
      return {
        ...p,
        ...(lang && i18n ? i18n[lang] : {}),
        oauthAvailable: p.authType === "oauth" && p.id === "gmail" && googleOAuthConfigured(),
      };
    }),
  );
});

// [2026-09-28] GET /mail-providers/discover?domain=... -- siehe
// mail/autodiscover.ts. Ebenfalls vor dem Login erreichbar (Onboarding),
// deshalb mit einfacher Bremse je IP: jede Anfrage loest DNS-/ISPDB-Abfragen
// aus.
const DISCOVER_LIMIT_PER_MINUTE = 30;
const discoverHits = new Map<string, { count: number; windowStart: number }>();

function overLimit(ip: string): boolean {
  const now = Date.now();
  const entry = discoverHits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    if (discoverHits.size > 10_000) discoverHits.clear();
    discoverHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  return ++entry.count > DISCOVER_LIMIT_PER_MINUTE;
}

mailProvidersRouter.get("/mail-providers/discover", async (req, res) => {
  if (overLimit(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Zu viele Anfragen, bitte kurz warten." });
  }

  const domain = typeof req.query.domain === "string" ? req.query.domain.trim().toLowerCase() : "";
  if (!isValidDomain(domain)) {
    return res.status(400).json({ error: "ungültige Domain" });
  }
  res.json(await discoverMailSettings(domain));
});

// [2026-09-28] POST /mail-providers/probe -- Testverbindung ohne Anmeldung
// (siehe mail/probe.ts): antwortet der Eingangs- und ggf. der
// Postausgangsserver ueberhaupt? Gleiche Bremse wie discover.
function parseEndpoint(v: unknown): { host: string; port: number; secure: boolean } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const host = typeof o.host === "string" ? o.host.trim().toLowerCase() : "";
  const port = typeof o.port === "number" ? o.port : NaN;
  if (!isValidDomain(host) || !MAIL_PORTS.has(port)) return null;
  return { host, port, secure: o.secure !== false };
}

mailProvidersRouter.post("/mail-providers/probe", async (req, res) => {
  if (overLimit(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "Zu viele Anfragen, bitte kurz warten." });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const incoming = parseEndpoint(body.incoming);
  if (!incoming) {
    return res.status(400).json({ error: "incoming braucht host (Domain) und einen Mail-Port (993, 143, 995, 110 ...)" });
  }
  const outgoing = body.outgoing === undefined || body.outgoing === null ? null : parseEndpoint(body.outgoing);
  const [incomingResult, outgoingResult] = await Promise.all([
    probeMailServer(incoming.host, incoming.port, incoming.secure),
    outgoing ? probeMailServer(outgoing.host, outgoing.port, outgoing.secure) : Promise.resolve(null),
  ]);
  res.json({ incoming: incomingResult, outgoing: outgoingResult });
});
