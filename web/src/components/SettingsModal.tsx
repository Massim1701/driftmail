import { useEffect, useState } from "react";
import type { AbsenceResponder, AccentTheme, DataBreachFinding, MailAccount, PrivacySettings } from "../types";
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
  onAbsenceResponderChange,
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
  /** [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent"
   * -- meldet ein erfolgreiches Speichern hier an App.tsx zurück, damit der
   * dortige (von diesem Dialog unabhängige) Banner sofort mitzieht. */
  onAbsenceResponderChange: (updated: AbsenceResponder) => void;
  onOpenAiSettings: () => void;
  onClose: () => void;
}) {
  const [accentTheme, setAccentTheme] = useState<AccentTheme | null>(null);
  const [accentLoading, setAccentLoading] = useState(true);
  const [accentSaving, setAccentSaving] = useState<AccentTheme | null>(null);
  const [accentError, setAccentError] = useState<string | null>(null);

  const [strictSaving, setStrictSaving] = useState(false);
  const [strictError, setStrictError] = useState<string | null>(null);

  // [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-Recherche"
  // Punkt 2 ("Nudge") -- eigener lokaler State + eigener GET/PUT, gleiches
  // Prinzip wie accentTheme oben (kein anderer Screen braucht diesen Wert,
  // anders als strictUnknownSenders, das in App.tsx lebt).
  const [nudgeEnabled, setNudgeEnabled] = useState(true);
  const [nudgeSaving, setNudgeSaving] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);

  // [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 1
  // ("Tracking-Pixel-Blockierung").
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [privacySaving, setPrivacySaving] = useState<keyof PrivacySettings | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  // [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 3 ("Darkweb-/
  // Datenleck-Ueberwachung") -- nur unbestaetigte Treffer werden hier
  // prominent gezeigt, siehe handleAcknowledgeBreach.
  const [breaches, setBreaches] = useState<DataBreachFinding[]>([]);
  const [breachesLoading, setBreachesLoading] = useState(true);
  const [acknowledgingBreachId, setAcknowledgingBreachId] = useState<string | null>(null);

  const [appLockPending, setAppLockPending] = useState(false);
  const [appLockError, setAppLockError] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Lokales Formular fuer den Abwesenheitsassistenten -- eigener Ladevorgang
  // beim Öffnen dieses Dialogs, gleiches Prinzip wie accentTheme direkt
  // darüber (eigener GET-Aufruf statt Prop-Synchronisation aus App.tsx, das
  // haette bei jedem Prop-Update einen Effekt gebraucht, der State während
  // des Renderns synchronisiert -- App.tsx hat GET /absence-responder
  // trotzdem selbst, weil der Banner dort unabhängig von diesem Dialog
  // sichtbar sein muss). Erst ein erfolgreiches Speichern meldet den neuen
  // Stand ueber onAbsenceResponderChange zurueck an App.tsx (fuer den Banner).
  const [absenceActive, setAbsenceActive] = useState(false);
  const [absenceStartDate, setAbsenceStartDate] = useState("");
  const [absenceEndDate, setAbsenceEndDate] = useState("");
  const [absenceSubject, setAbsenceSubject] = useState("");
  const [absenceBody, setAbsenceBody] = useState("");
  const [absenceLoading, setAbsenceLoading] = useState(true);
  const [absenceSaving, setAbsenceSaving] = useState(false);
  const [absenceError, setAbsenceError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAbsenceResponder()
      .then((a) => {
        setAbsenceActive(a.active);
        setAbsenceStartDate(a.startDate ?? "");
        setAbsenceEndDate(a.endDate ?? "");
        setAbsenceSubject(a.subject ?? "");
        setAbsenceBody(a.body ?? "");
      })
      .catch(() => setAbsenceError("Abwesenheitsassistent konnte nicht geladen werden."))
      .finally(() => setAbsenceLoading(false));
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setAccentTheme(s.accentTheme);
        setNudgeEnabled(s.nudgeUnansweredEnabled);
      })
      .catch(() => setAccentError("Einstellungen konnten nicht geladen werden."))
      .finally(() => setAccentLoading(false));
  }, []);

  useEffect(() => {
    api
      .getPrivacySettings()
      .then(setPrivacySettings)
      .catch(() => setPrivacyError("Privatsphäre-Einstellungen konnten nicht geladen werden."))
      .finally(() => setPrivacyLoading(false));
  }, []);

  useEffect(() => {
    api
      .listBreaches()
      .then(setBreaches)
      .catch(() => {
        // Kein harter Fehler: die Sicherheits-Übersicht funktioniert auch
        // ohne diesen Abschnitt, ohnehin nur relevant, falls es Treffer gibt.
      })
      .finally(() => setBreachesLoading(false));
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

  async function handleToggleNudge() {
    if (nudgeSaving) return;
    setNudgeSaving(true);
    setNudgeError(null);
    const previous = nudgeEnabled;
    setNudgeEnabled(!previous);
    try {
      await api.updateSettings({ nudgeUnansweredEnabled: !previous });
    } catch {
      setNudgeEnabled(previous);
      setNudgeError("Einstellung konnte nicht gespeichert werden.");
    } finally {
      setNudgeSaving(false);
    }
  }

  async function handleTogglePrivacySetting(key: keyof PrivacySettings) {
    if (!privacySettings || privacySaving) return;
    setPrivacySaving(key);
    setPrivacyError(null);
    const previous = privacySettings;
    const next = { ...previous, [key]: !previous[key] };
    setPrivacySettings(next);
    try {
      setPrivacySettings(await api.updatePrivacySettings({ [key]: next[key] }));
    } catch {
      setPrivacySettings(previous);
      setPrivacyError("Einstellung konnte nicht gespeichert werden.");
    } finally {
      setPrivacySaving(null);
    }
  }

  async function handleAcknowledgeBreach(id: string) {
    setAcknowledgingBreachId(id);
    try {
      const updated = await api.acknowledgeBreach(id);
      setBreaches((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch {
      // Best effort -- der Treffer bleibt einfach sichtbar, User kann es
      // erneut versuchen, kein harter Fehlerzustand nötig für eine reine
      // "als gesehen markieren"-Aktion.
    } finally {
      setAcknowledgingBreachId(null);
    }
  }

  // Ein "Speichern"-Button fuer das gesamte Formular statt Sofort-Speichern
  // pro Feld (anders als die einzelnen Toggles oben) -- mehrere Felder
  // gehoeren inhaltlich zusammen (z.B. waere ein Aktivieren ohne bereits
  // eingetragenen Betreff sonst serverseitig sofort ein 400). Validierung
  // selbst laeuft NICHT client-seitig doppelt, sondern zeigt die 400-
  // Fehlermeldung vom Server direkt an (siehe absenceError unten) --
  // dieselben drei Pflichtfelder waeren sonst an zwei Stellen zu pflegen.
  async function handleSaveAbsenceResponder() {
    setAbsenceSaving(true);
    setAbsenceError(null);
    try {
      const updated = await api.updateAbsenceResponder({
        active: absenceActive,
        startDate: absenceStartDate || null,
        endDate: absenceEndDate || null,
        subject: absenceSubject || null,
        body: absenceBody || null,
      });
      onAbsenceResponderChange(updated);
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === "object" && err.body && "error" in err.body) {
        setAbsenceError(String((err.body as { error: unknown }).error));
      } else {
        setAbsenceError("Abwesenheitsassistent konnte nicht gespeichert werden.");
      }
    } finally {
      setAbsenceSaving(false);
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

            {/* [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 3
                ("Darkweb-/Datenleck-Ueberwachung") -- nur unbestaetigte
                Treffer werden hier gezeigt, direkt oben im Sicherheits-
                Abschnitt (echte Warnung, soll auffallen). Nutzt die
                bestehende Warnfarbe (Design-Richtung: Akzentfarbe bleibt
                Sicherheits-Badges vorbehalten). */}
            {!breachesLoading && breaches.some((b) => !b.acknowledged) && (
              <ul className="settings-breach-list">
                {breaches
                  .filter((b) => !b.acknowledged)
                  .map((b) => (
                    <li key={b.id} className="settings-breach-item">
                      <span>
                        Deine Adresse wurde im Datenleck „{b.breachName}“ gefunden
                        {b.breachDate ? ` (${new Date(b.breachDate).toLocaleDateString("de-DE")})` : ""}.
                      </span>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleAcknowledgeBreach(b.id)}
                        disabled={acknowledgingBreachId === b.id}
                      >
                        {acknowledgingBreachId === b.id ? "…" : "Verstanden"}
                      </button>
                    </li>
                  ))}
              </ul>
            )}

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
                Features") -- bewusst KEINE technischen Details. [2026-09-21]
                "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": Malware-
                Scan-Zeile aktualisiert -- laeuft jetzt echt ueber ClamAV
                (siehe backend/README.md "Malware-Scan"), nicht mehr nur
                ein Mock. */}
            <p className="settings-security-intro">driftmail schützt dich automatisch im Hintergrund:</p>
            <ul className="settings-security-list">
              <li>Erkennt Spam, Phishing und klassischen Vorschussbetrug automatisch</li>
              <li>Warnt bei gefälschten Anzeigenamen, abweichenden Antwort-Adressen und plötzlichen IBAN-Wechseln in laufenden Gesprächen</li>
              <li>Kennzeichnet neue, unbekannte Absender</li>
              <li>Whitelist: du entscheidest, wem du vertraust</li>
              <li>Warnt vor dem Versand sensibler Daten (IBAN, Kreditkartennummern)</li>
              <li>Echter Virenscan für Anhänge, beim Senden und Empfangen</li>
              <li>Warnt, falls deine Adresse in einem bekannten Datenleck auftaucht</li>
              <li>KI-Funktionen laufen wo möglich direkt auf deinem Gerät – keine Kosten, keine Cloud-Übertragung, außer du richtest ausdrücklich einen eigenen KI-Zugang ein</li>
            </ul>
          </section>

          {/* [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 1
              ("Tracking-Pixel-Blockierung"). */}
          <section className="settings-section">
            <h3 className="settings-section-title">Privatsphäre</h3>
            {privacyLoading ? (
              <p>Lade…</p>
            ) : (
              privacySettings && (
                <>
                  <div className="settings-row">
                    <button
                      type="button"
                      className={`btn btn-secondary${privacySettings.blockRemoteImages ? " active" : ""}`}
                      onClick={() => handleTogglePrivacySetting("blockRemoteImages")}
                      disabled={privacySaving === "blockRemoteImages"}
                    >
                      {privacySaving === "blockRemoteImages" ? "…" : privacySettings.blockRemoteImages ? "Externe Bilder blockieren: an" : "Externe Bilder blockieren: aus"}
                    </button>
                  </div>
                  <p className="settings-privacy-note">
                    driftmail zeigt Mails grundsätzlich als Klartext an, ohne automatisch ladende Bilder oder Tracking-Pixel –
                    Absender können so nicht sehen, ob und wann du eine Mail geöffnet hast. Dieser Schalter ist also eher eine
                    Bestätigung dieses Schutzes als eine Funktion mit zusätzlicher sichtbarer Wirkung.
                  </p>
                  <div className="settings-row">
                    <button
                      type="button"
                      className={`btn btn-secondary${privacySettings.blockTrackingLinks ? " active" : ""}`}
                      onClick={() => handleTogglePrivacySetting("blockTrackingLinks")}
                      disabled={privacySaving === "blockTrackingLinks"}
                    >
                      {privacySaving === "blockTrackingLinks" ? "…" : privacySettings.blockTrackingLinks ? "Tracking-Links blockieren: an" : "Tracking-Links blockieren: aus"}
                    </button>
                  </div>
                  {privacyError && <p className="send-error">{privacyError}</p>}
                </>
              )
            )}
          </section>

          {/* [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-
              Recherche" Punkt 2 ("Nudge"). */}
          <section className="settings-section">
            <h3 className="settings-section-title">Erinnerungen</h3>
            <div className="settings-row">
              <button
                type="button"
                className={`btn btn-secondary${nudgeEnabled ? " active" : ""}`}
                onClick={handleToggleNudge}
                disabled={nudgeSaving || accentLoading}
              >
                {nudgeSaving ? "…" : nudgeEnabled ? "An unbeantwortete Mails erinnern: an" : "An unbeantwortete Mails erinnern: aus"}
              </button>
            </div>
            {nudgeError && <p className="send-error">{nudgeError}</p>}
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Abwesenheitsassistent</h3>
            {/* WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent":
                Ein/Aus + Zeitraum + Betreff/Text. Bestehende Default-
                Signatur wird serverseitig automatisch angehängt (siehe
                backend/README.md), deshalb kein eigenes Signatur-Feld hier.
                Speichern ist bewusst ein einzelner Button für das ganze
                Formular statt Sofort-Speichern pro Feld, siehe
                handleSaveAbsenceResponder-Kommentar. */}
            {absenceLoading ? (
              <p>Lade…</p>
            ) : (
              <>
                <label className="absence-field absence-field-checkbox">
                  <input type="checkbox" checked={absenceActive} onChange={(e) => setAbsenceActive(e.target.checked)} />
                  Automatische Antwort aktiv
                </label>
                <label className="absence-field">
                  <span>Start</span>
                  <input type="date" value={absenceStartDate} onChange={(e) => setAbsenceStartDate(e.target.value)} />
                </label>
                <label className="absence-field">
                  <span>Ende (optional)</span>
                  <input type="date" value={absenceEndDate} onChange={(e) => setAbsenceEndDate(e.target.value)} />
                </label>
                <label className="absence-field">
                  <span>Betreff</span>
                  <input
                    type="text"
                    value={absenceSubject}
                    onChange={(e) => setAbsenceSubject(e.target.value)}
                    placeholder="Automatische Abwesenheitsantwort"
                  />
                </label>
                <label className="absence-field absence-field-textarea">
                  <span>Nachricht</span>
                  <textarea
                    value={absenceBody}
                    onChange={(e) => setAbsenceBody(e.target.value)}
                    rows={4}
                    placeholder="Ich bin derzeit nicht erreichbar und melde mich nach meiner Rückkehr."
                  />
                </label>
                {absenceError && <p className="send-error">{absenceError}</p>}
                <button type="button" className="btn btn-secondary" onClick={handleSaveAbsenceResponder} disabled={absenceSaving}>
                  {absenceSaving ? "Speichere…" : "Speichern"}
                </button>
              </>
            )}
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
