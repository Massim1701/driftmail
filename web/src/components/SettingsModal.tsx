import { useEffect, useState } from "react";
import type { AccentTheme, MailAccount } from "../types";
import { api, ApiError } from "../api";
import { ACCENT_THEMES, applyAccentTheme } from "../accentThemes";
import "./ComposeModal.css";
import "./SettingsModal.css";

// [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG - Einstellungsbereich +
// Info-Seite", Punkt 1 (In-App-UI -- Punkt 2, die öffentliche Info-Seite
// auf driftware.online, läuft separat über eine andere Claude-Session, hier
// bewusst nicht angefasst). Bündelt, was bisher einzeln in FolderSidebar.tsx
// verstreut war (App-Sperre-Toggle, KI-Einstellungen-Link) PLUS neu:
// Konten-Entfernen, Akzentfarben-Auswahl, Sicherheits-Feature-Übersicht,
// Anleitungs-Link.
export function SettingsModal({
  accounts,
  onAccountRemoved,
  onAddAccount,
  appLockSupported,
  appLockEnabled,
  onAppLockChange,
  strictUnknownSenders,
  onStrictUnknownSendersChange,
  onOpenAiSettings,
  onClose,
}: {
  accounts: MailAccount[];
  /** Nach erfolgreichem Entfernen: App.tsx lädt die Kontenliste (+ aktives
   * Konto falls nötig) neu, siehe App.tsx loadAccounts(). */
  onAccountRemoved: () => void;
  /** Öffnet denselben Onboarding-Bildschirm wie beim Erst-Login (App.tsx
   * handleAddAccount) -- übernimmt beim Aufruf komplett den Bildschirm,
   * deshalb schließt dieser Dialog sich dabei gleich mit (siehe Klick-
   * Handler unten), sonst würde er beim Zurückkommen unvermittelt wieder
   * offen sein. */
  onAddAccount: () => void;
  appLockSupported: boolean;
  appLockEnabled: boolean;
  onAppLockChange: (enabled: boolean) => Promise<boolean>;
  /** [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt 1
   * ("Unbekannte Absender streng behandeln") -- lebt in App.tsx (analog
   * trustedSenderAddresses), weil MessageDetailPane/MessageList den Wert
   * für die Badge-Darstellung ebenfalls brauchen, nicht nur dieser Dialog
   * hier. Gleiches Prop-Muster wie appLockEnabled/onAppLockChange oben. */
  strictUnknownSenders: boolean;
  onStrictUnknownSendersChange: (enabled: boolean) => Promise<boolean>;
  onOpenAiSettings: () => void;
  onClose: () => void;
}) {
  const [accentTheme, setAccentTheme] = useState<AccentTheme | null>(null);
  const [accentLoading, setAccentLoading] = useState(true);
  const [accentSaving, setAccentSaving] = useState<AccentTheme | null>(null);
  const [accentError, setAccentError] = useState<string | null>(null);

  const [strictSaving, setStrictSaving] = useState(false);
  const [strictError, setStrictError] = useState<string | null>(null);

  const [appLockPending, setAppLockPending] = useState(false);
  const [appLockError, setAppLockError] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setAccentTheme(s.accentTheme))
      .catch(() => setAccentError("Einstellungen konnten nicht geladen werden."))
      .finally(() => setAccentLoading(false));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSelectAccent(theme: AccentTheme) {
    if (theme === accentTheme || accentSaving) return;
    setAccentSaving(theme);
    setAccentError(null);
    const previous = accentTheme;
    // Optimistisch: sofort sichtbar umfärben, bei Fehler zurückrollen.
    setAccentTheme(theme);
    applyAccentTheme(theme);
    try {
      await api.updateSettings({ accentTheme: theme });
    } catch {
      setAccentTheme(previous);
      if (previous) applyAccentTheme(previous);
      setAccentError("Akzentfarbe konnte nicht gespeichert werden.");
    } finally {
      setAccentSaving(null);
    }
  }

  async function handleToggleStrictUnknownSenders() {
    if (strictSaving) return;
    setStrictSaving(true);
    setStrictError(null);
    try {
      const ok = await onStrictUnknownSendersChange(!strictUnknownSenders);
      if (!ok) setStrictError("Einstellung konnte nicht gespeichert werden.");
    } finally {
      setStrictSaving(false);
    }
  }

  async function toggleAppLock() {
    setAppLockPending(true);
    setAppLockError(false);
    try {
      const ok = await onAppLockChange(!appLockEnabled);
      if (!ok) setAppLockError(true);
    } finally {
      setAppLockPending(false);
    }
  }

  async function handleRemoveAccount(account: MailAccount) {
    if (accounts.length <= 1) return; // clientseitig schon deaktiviert, siehe unten -- doppelte Absicherung
    if (!window.confirm(`Konto "${account.emailAddress}" wirklich entfernen? Alle lokal gespeicherten Ordner/Nachrichten dieses Kontos gehen dabei verloren.`)) {
      return;
    }
    setRemovingId(account.id);
    setAccountError(null);
    try {
      await api.deleteAccount(account.id);
      onAccountRemoved();
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === "object" && err.body && "error" in err.body) {
        setAccountError(String((err.body as { error: unknown }).error));
      } else {
        setAccountError("Konto konnte nicht entfernt werden.");
      }
    } finally {
      setRemovingId(null);
    }
  }

  function handleAddAccountClick() {
    onClose();
    onAddAccount();
  }

  // [2026-09-21] Fund beim Testen: AiSettingsModal und SettingsModal sind
  // beide fixe Overlays mit gleichem z-index (.compose-overlay) -- wenn
  // beide gleichzeitig offen wären, würde SettingsModal (später im DOM,
  // siehe App.tsx-Reihenfolge) AiSettingsModal einfach verdecken, ohne
  // sichtbaren Fehler. Deshalb hier bewusst NICHT gestapelt: Settings
  // schließt sich, bevor KI-Einstellungen öffnet, gleiches Prinzip wie
  // handleAddAccountClick oben.
  function handleOpenAiSettingsClick() {
    onClose();
    onOpenAiSettings();
  }

  return (
    <div className="compose-overlay" role="dialog" aria-modal="true" aria-label="Einstellungen" onClick={onClose}>
      <div className="compose-modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compose-modal-header">
          <h2>Einstellungen</h2>
          <button type="button" className="link-button" onClick={onClose} aria-label="Schließen">
            Schließen
          </button>
        </div>

        <div className="compose-fields settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Konten</h3>
            <ul className="settings-account-list">
              {accounts.map((a) => (
                <li key={a.id} className="settings-account-row">
                  <span>{a.emailAddress}</span>
                  <button
                    type="button"
                    className="link-button settings-account-remove"
                    onClick={() => handleRemoveAccount(a)}
                    disabled={accounts.length <= 1 || removingId === a.id}
                    title={accounts.length <= 1 ? "Letztes Konto kann nicht entfernt werden" : "Konto entfernen"}
                  >
                    {removingId === a.id ? "Entferne…" : "Entfernen"}
                  </button>
                </li>
              ))}
            </ul>
            {accountError && <p className="send-error">{accountError}</p>}
            <button type="button" className="btn btn-secondary" onClick={handleAddAccountClick}>
              Konto hinzufügen
            </button>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Ansicht</h3>
            {accentLoading ? (
              <p>Lade…</p>
            ) : (
              <>
                <div className="accent-swatch-grid" role="radiogroup" aria-label="Akzentfarbe">
                  {ACCENT_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={accentTheme === t.id}
                      className={`accent-swatch${accentTheme === t.id ? " active" : ""}`}
                      style={{ background: t.gradient ? `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` : t.accent }}
                      onClick={() => handleSelectAccent(t.id)}
                      title={t.label}
                      aria-label={t.label}
                    />
                  ))}
                </div>
                {accentError && <p className="send-error">{accentError}</p>}
              </>
            )}
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Sicherheit</h3>
            {appLockSupported && (
              <div className="settings-row">
                <button
                  type="button"
                  className={`btn btn-secondary${appLockEnabled ? " active" : ""}`}
                  onClick={toggleAppLock}
                  disabled={appLockPending}
                >
                  {appLockPending ? "…" : appLockEnabled ? "App-Sperre an" : "App-Sperre aus"}
                </button>
                {appLockError && <span className="app-lock-toggle-error">Einrichtung fehlgeschlagen.</span>}
              </div>
            )}
            <div className="settings-row">
              <button type="button" className="btn btn-secondary" onClick={handleOpenAiSettingsClick}>
                KI-Einstellungen
              </button>
            </div>

            {/* [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-
                FEATURES" Punkt 1: steuert nur die Client-Darstellung von
                isNewSender-Nachrichten (siehe MessageDetailPane.tsx/
                MessageList.tsx), das Backend-Signal selbst bleibt
                unverändert -- Default an, wie im Auftrag vorgegeben. */}
            <div className="settings-row">
              <button
                type="button"
                className={`btn btn-secondary${strictUnknownSenders ? " active" : ""}`}
                onClick={handleToggleStrictUnknownSenders}
                disabled={strictSaving}
              >
                {strictSaving ? "…" : strictUnknownSenders ? "Unbekannte Absender streng behandeln: an" : "Unbekannte Absender streng behandeln: aus"}
              </button>
            </div>
            {strictError && <p className="send-error">{strictError}</p>}

            {/* Plain-language Sicherheits-Übersicht (WEB_INBOX.md 21.09.,
                "kurze, verstaendliche Uebersicht der aktiven Sicherheits-
                Features") -- bewusst KEINE technischen Details, siehe
                Malware-Scan-Zeile: der ist noch ein Mock
                (backend/src/lookups/attachmentScanMock.ts), deshalb
                ehrlich "in Vorbereitung" statt fälschlich als aktiv
                dargestellt. */}
            <p className="settings-security-intro">driftmail schützt dich automatisch im Hintergrund:</p>
            <ul className="settings-security-list">
              <li>Erkennt Spam, Phishing und klassischen Vorschussbetrug automatisch</li>
              <li>Warnt bei gefälschten Anzeigenamen, abweichenden Antwort-Adressen und plötzlichen IBAN-Wechseln in laufenden Gesprächen</li>
              <li>Kennzeichnet neue, unbekannte Absender</li>
              <li>Whitelist: du entscheidest, wem du vertraust</li>
              <li>Warnt vor dem Versand sensibler Daten (IBAN, Kreditkartennummern)</li>
              <li>Malware-Scan für Anhänge: in Vorbereitung</li>
              <li>KI-Funktionen laufen wo möglich direkt auf deinem Gerät – keine Kosten, keine Cloud-Übertragung, außer du richtest ausdrücklich einen eigenen KI-Zugang ein</li>
            </ul>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Anleitung</h3>
            {/* Platzhalter-URL: verweist auf die Startseite, bis die andere
                Claude-Session die öffentliche Info-Seite (WEB_INBOX.md
                21.09. "Inhalts-Paket") mit einer konkreten Unterseiten-Route
                fertig hat -- dann hier auf die genaue Route verschärfen. */}
            <a className="settings-guide-link" href="https://driftware.online" target="_blank" rel="noopener noreferrer">
              Installationsanleitung
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
