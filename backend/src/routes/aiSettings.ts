// GET/PUT /ai-settings (TERMINAL_INBOX.md 21.09. KORREKTUR, ersetzt
// WEB_INBOX.md "ECHTE KI-ANBINDUNG" c3ec563): eigene Cloud-KI-Zugangsdaten
// des Users (BYOK) -- kein driftmail-finanzierter Cloud-Key, siehe
// backend/README.md "KI-Anbindung (BYOK)".

import { Router } from "express";
import { store } from "../db/store";
import { encryptCredentials } from "../auth/credentialsEncryption";
import type { AiPreferenceMode, AiProvider } from "../types";

export const aiSettingsRouter = Router();

// Nur diese beiden sind in src/ai/cloudAdapter.ts wirklich angebunden --
// 'google'/'other' existieren im Contract/DB-Enum fuer spaetere
// Erweiterung, werden hier aber schon beim Speichern klar abgelehnt statt
// erst beim tatsaechlichen Versand still zu scheitern.
const IMPLEMENTED_PROVIDERS: AiProvider[] = ["anthropic", "openai"];

function toApiAiSettings(pref: { mode: AiPreferenceMode; byokProvider: AiProvider | null; encryptedApiKey: string | null; cloudConsentGivenAt: string | null } | undefined) {
  return {
    mode: pref?.mode ?? "off",
    byokProvider: pref?.byokProvider ?? null,
    hasApiKey: !!pref?.encryptedApiKey,
    cloudConsentGiven: !!pref?.cloudConsentGivenAt,
  };
}

aiSettingsRouter.get("/ai-settings", async (req, res) => {
  const pref = await store.getAiPreference(req.userId);
  res.json(toApiAiSettings(pref));
});

aiSettingsRouter.put("/ai-settings", async (req, res) => {
  const body = req.body as { mode?: AiPreferenceMode; byokProvider?: AiProvider; apiKey?: string; cloudConsent?: boolean };

  if (body.mode !== undefined && body.mode !== "off" && body.mode !== "byok") {
    return res.status(400).json({ error: "mode muss 'off' oder 'byok' sein" });
  }

  const existing = await store.getAiPreference(req.userId);
  const targetMode = body.mode ?? existing?.mode ?? "off";

  if (targetMode === "off") {
    const updated = await store.setAiPreference(req.userId, {
      mode: "off",
      byokProvider: null,
      encryptedApiKey: null,
      // [2026-09-21] Consent wird beim Ausschalten IMMER mit zurueckgesetzt
      // -- ein spaeteres erneutes Aktivieren von BYOK verlangt bewusst
      // wieder ein explizites Consent, kein "totes" Consent-Flag, das
      // unbemerkt Monate spaeter ohne erneute Bestaetigung wieder greift.
      cloudConsentGivenAt: null,
    });
    return res.json(toApiAiSettings(updated));
  }

  // targetMode === "byok"
  const provider = body.byokProvider ?? existing?.byokProvider ?? undefined;
  if (!provider) {
    return res.status(400).json({ error: "byokProvider ist erforderlich, wenn mode=byok gesetzt wird" });
  }
  if (!IMPLEMENTED_PROVIDERS.includes(provider)) {
    return res.status(400).json({
      error: `Anbieter '${provider}' ist noch nicht implementiert. Aktuell unterstuetzt: ${IMPLEMENTED_PROVIDERS.join(", ")}.`,
    });
  }
  // apiKey darf weggelassen werden, wenn schon einer hinterlegt ist (z.B.
  // nur cloudConsent aendern) -- aber nicht beim allerersten Aktivieren.
  if (!body.apiKey && !existing?.encryptedApiKey) {
    return res.status(400).json({ error: "apiKey ist erforderlich, wenn noch kein Key hinterlegt ist" });
  }

  const patch: Parameters<typeof store.setAiPreference>[1] = {
    mode: "byok",
    byokProvider: provider,
  };
  if (body.apiKey) patch.encryptedApiKey = encryptCredentials(body.apiKey);
  if (body.cloudConsent !== undefined) patch.cloudConsentGivenAt = body.cloudConsent ? new Date().toISOString() : null;

  const updated = await store.setAiPreference(req.userId, patch);
  res.json(toApiAiSettings(updated));
});
