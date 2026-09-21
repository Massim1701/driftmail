import { useEffect, useState } from "react";
import type { AiSettings } from "../types";
import { api, ApiError } from "../api";
import "./ComposeModal.css";
import "./AiSettingsModal.css";

// [2026-09-21] KI-Einstellungen (TERMINAL_INBOX.md 21.09. KORREKTUR, ersetzt
// WEB_INBOX.md "ECHTE KI-ANBINDUNG" c3ec563): kein driftmail-finanzierter
// Cloud-Key -- Cloud-KI läuft nur, wenn der User selbst einen eigenen
// API-Key hinterlegt ("BYOK"), auf seine eigenen Kosten, nur mit
// explizitem Consent. Geräte-eigene KI (siehe onDeviceAi.ts) ist die
// primäre Quelle und braucht keine Einstellung hier -- sie wird automatisch
// versucht, bevor diese Cloud-Konfiguration überhaupt relevant wird.
//
// Nur 'anthropic'/'openai' sind serverseitig wirklich angebunden (siehe
// backend/README.md "KI-Anbindung (BYOK)") -- deshalb werden hier bewusst
// NUR diese beiden als Provider-Optionen angeboten, nicht die vollen vier
// aus dem Contract-Enum (google/other würden nur zu einem 400 beim
// Speichern führen).
const IMPLEMENTED_PROVIDERS: Array<{ value: "anthropic" | "openai"; label: string }> = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
];

export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    api
      .getAiSettings()
      .then((s) => {
        setSettings(s);
        setEnabled(s.mode === "byok");
        if (s.byokProvider === "anthropic" || s.byokProvider === "openai") setProvider(s.byokProvider);
        setConsent(s.cloudConsentGiven);
      })
      .catch(() => setError("KI-Einstellungen konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (!enabled) {
        const updated = await api.setAiSettings({ mode: "off" });
        setSettings(updated);
        setConsent(false);
        setApiKey("");
      } else {
        if (!apiKey.trim() && !settings?.hasApiKey) {
          setError("Bitte einen API-Key eintragen.");
          setSaving(false);
          return;
        }
        const updated = await api.setAiSettings({
          mode: "byok",
          byokProvider: provider,
          apiKey: apiKey.trim() || undefined,
          cloudConsent: consent,
        });
        setSettings(updated);
        setApiKey("");
      }
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === "object" && err.body && "error" in err.body) {
        setError(String((err.body as { error: unknown }).error));
      } else {
        setError("Speichern fehlgeschlagen. Bitte später erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="compose-overlay" role="dialog" aria-modal="true" aria-label="KI-Einstellungen" onClick={onClose}>
      <div className="compose-modal ai-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compose-modal-header">
          <h2>KI-Einstellungen</h2>
          <button type="button" className="link-button" onClick={onClose} aria-label="Schließen">
            Schließen
          </button>
        </div>

        <div className="compose-fields">
          <p className="ai-settings-intro">
            Geräte-eigene KI (falls dein Browser das unterstützt) ist immer die erste Quelle für Zusammenfassungen und
            KI-Entwürfe -- dabei verlässt nichts dein Gerät. Cloud-KI ist optional und läuft nur mit deinem eigenen
            API-Key, auf deine eigenen Kosten. driftmail stellt keinen eigenen Cloud-Zugang bereit.
          </p>

          {loading ? (
            <p>Lade…</p>
          ) : (
            <>
              <label className="compose-field ai-settings-toggle">
                <span>Cloud-KI</span>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>{enabled ? "aktiviert" : "aus"}</span>
              </label>

              {enabled && (
                <>
                  <label className="compose-field">
                    <span>Anbieter</span>
                    <select value={provider} onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}>
                      {IMPLEMENTED_PROVIDERS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="compose-field">
                    <span>API-Key</span>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={settings?.hasApiKey ? "Bereits hinterlegt -- leer lassen zum Beibehalten" : "sk-…"}
                      autoComplete="off"
                    />
                  </label>
                  <label className="ai-settings-consent">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>
                      Ich stimme zu, dass Mail-Inhalte bei aktivierter Cloud-KI an den gewählten Anbieter ({provider})
                      gesendet werden.
                    </span>
                  </label>
                </>
              )}

              {error && <p className="send-error">{error}</p>}
            </>
          )}
        </div>

        <div className="compose-modal-actions">
          <div className="compose-modal-actions-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || loading || (enabled && !consent)}>
            {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
