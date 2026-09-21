// OnboardingScreen — [2026-09-21] WEB_INBOX.md 19.09. "Onboarding: Provider-
// Auswahlbildschirm": ersetzt den bisherigen LoginScreen (der nur Gmail
// kannte) als Einstiegspunkt, solange kein Token vorhanden ist (App.tsx
// `if (!token)`-Gate). Zwei Schritte, rein lokaler State (kein Router im
// Projekt, siehe web/README.md):
//
// 1. Provider-Auswahl: GET /mail-providers liefert Label/authType/
//    comingSoon/IMAP-Presets (contracts/mail-providers.json). oauth+nicht
//    comingSoon (aktuell nur Gmail) navigiert per echtem Browser-Redirect
//    zu GET /auth/google/start (wie zuvor LoginScreen) -- kein `fetch`, das
//    wäre für einen Redirect zu Google falsch. comingSoon-Provider
//    (Outlook/Yahoo) sind nicht klickbar, zeigen nur ein "demnächst"-Label.
// 2. IMAP-Formular: für alle authType="imap"-Provider (iCloud/GMX/web.de/
//    generisch), vorbefüllt aus dem gewählten MailProvider-Preset (Host/
//    Port/TLS). POST /accounts (provider=imap) verifiziert die Zugangsdaten
//    serverseitig per echtem IMAP-Login (siehe api-spec.yaml) -- 422 heißt
//    hier "falsche Adresse/falsches App-Passwort", nicht ein generischer
//    Netzwerkfehler.
//
// Fallback-Liste: falls GET /mail-providers (noch) nicht erreichbar ist
// (z.B. älterer Mock-Server ohne diese Route), bleibt wenigstens Gmail
// nutzbar, damit der Login-Weg nicht komplett blockiert.

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, googleLoginUrl, setStoredToken } from "../api";
import type { MailProvider } from "../types";
import "./OnboardingScreen.css";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "Google-Anmeldung ist auf diesem Server noch nicht konfiguriert.",
  missing_code: "Anmeldung bei Google wurde abgebrochen oder ist fehlgeschlagen.",
  token_exchange_failed: "Anmeldung bei Google ist fehlgeschlagen. Bitte erneut versuchen.",
  userinfo_failed: "Kontodaten konnten nicht von Google abgerufen werden.",
  email_not_verified: "Diese Google-Adresse ist nicht verifiziert.",
  not_allowlisted: "Diese E-Mail-Adresse ist für driftmail (noch) nicht freigeschaltet.",
};

const FALLBACK_PROVIDERS: MailProvider[] = [
  {
    id: "gmail",
    label: "Gmail",
    authType: "oauth",
    comingSoon: false,
    imapHost: null,
    imapPort: null,
    imapSecure: null,
    smtpHost: null,
    smtpPort: null,
    smtpSecure: null,
    requiresAppPassword: false,
    appPasswordHelpUrl: null,
  },
];

export function OnboardingScreen({
  error,
  onConnected,
}: {
  error: string | null;
  /** IMAP-Weg: kein Redirect, daher muss App.tsx den neuen Token selbst
   * übernehmen (Gmail-Weg braucht das nicht -- echter Redirect + Reload). */
  onConnected: (token: string) => void;
}) {
  const [providers, setProviders] = useState<MailProvider[]>(FALLBACK_PROVIDERS);
  const [providersError, setProvidersError] = useState(false);
  const [selected, setSelected] = useState<MailProvider | null>(null);

  useEffect(() => {
    api
      .listMailProviders()
      .then(setProviders)
      .catch(() => setProvidersError(true));
  }, []);

  function selectProvider(p: MailProvider) {
    if (p.comingSoon || p.authType === "oauth") return;
    setSelected(p);
  }

  if (selected) {
    return <ImapConnectForm provider={selected} onBack={() => setSelected(null)} onConnected={onConnected} />;
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        <h1 className="onboarding-title">driftmail</h1>
        <p className="onboarding-subtitle">Wähle dein E-Mail-Konto, um loszulegen.</p>
        {error && <div className="onboarding-error">{ERROR_MESSAGES[error] ?? "Anmeldung fehlgeschlagen. Bitte erneut versuchen."}</div>}
        {providersError && (
          <div className="onboarding-hint">Anbieterliste konnte nicht geladen werden — Gmail ist trotzdem nutzbar.</div>
        )}
        <div className="provider-grid">
          {providers.map((p) => {
            const cardContent = (
              <>
                <span className="provider-label">{p.label}</span>
                <span className="provider-meta">
                  {p.comingSoon ? "demnächst" : p.authType === "oauth" ? "Anmelden" : "IMAP verbinden"}
                </span>
              </>
            );
            // Gmail (authType=oauth, nicht comingSoon): echter Browser-
            // Redirect per <a href>, kein programmatischer window.location-
            // Sprung -- gleiches Muster wie zuvor LoginScreen.tsx (kein
            // `fetch`, das wäre für einen Redirect zu Google falsch).
            if (!p.comingSoon && p.authType === "oauth") {
              return (
                <a key={p.id} className="provider-card" href={googleLoginUrl()}>
                  {cardContent}
                </a>
              );
            }
            return (
              <button
                key={p.id}
                type="button"
                className={`provider-card${p.comingSoon ? " coming-soon" : ""}`}
                onClick={() => selectProvider(p)}
                disabled={p.comingSoon}
              >
                {cardContent}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ImapConnectForm({
  provider,
  onBack,
  onConnected,
}: {
  provider: MailProvider;
  onBack: () => void;
  onConnected: (token: string) => void;
}) {
  const [emailAddress, setEmailAddress] = useState("");
  const [imapHost, setImapHost] = useState(provider.imapHost ?? "");
  const [imapPort, setImapPort] = useState(provider.imapPort ?? 993);
  const [imapSecure, setImapSecure] = useState(provider.imapSecure ?? true);
  const [imapUser, setImapUser] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(provider.imapHost === null);
  const [smtpHost, setSmtpHost] = useState(provider.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(provider.smtpPort ?? 587);
  const [smtpSecure, setSmtpSecure] = useState(provider.smtpSecure ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.connectImapAccount({
        emailAddress,
        imapHost,
        imapPort,
        imapSecure,
        imapUser: imapUser.trim() || undefined,
        imapPassword,
        smtpHost: smtpHost.trim() || undefined,
        smtpPort,
        smtpSecure,
      });
      setStoredToken(res.token);
      onConnected(res.token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setSubmitError("Verbindung fehlgeschlagen. Bitte E-Mail-Adresse, App-Passwort und Servereinstellungen prüfen.");
      } else if (err instanceof ApiError && err.status === 403) {
        setSubmitError("Diese E-Mail-Adresse ist für driftmail (noch) nicht freigeschaltet.");
      } else if (err instanceof ApiError && err.status === 400) {
        setSubmitError("Bitte alle Pflichtfelder ausfüllen.");
      } else {
        setSubmitError("Verbindung fehlgeschlagen. Bitte später erneut versuchen.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        <button type="button" className="onboarding-back" onClick={onBack}>
          ← Anderer Anbieter
        </button>
        <h1 className="onboarding-title">{provider.label}</h1>
        <p className="onboarding-subtitle">Verbinde dein Konto per IMAP.</p>

        {provider.requiresAppPassword && (
          <div className="app-password-hint">
            {provider.label} verlangt ein App-spezifisches Passwort statt deines normalen Kontopassworts.
            {provider.appPasswordHelpUrl && (
              <>
                {" "}
                <a href={provider.appPasswordHelpUrl} target="_blank" rel="noreferrer">
                  Anleitung für {provider.label}
                </a>
              </>
            )}
          </div>
        )}

        <form className="imap-form" onSubmit={handleSubmit}>
          <label className="imap-field">
            <span>E-Mail-Adresse</span>
            <input
              type="email"
              required
              autoFocus
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder="du@beispiel.de"
            />
          </label>
          <label className="imap-field">
            <span>{provider.requiresAppPassword ? "App-Passwort" : "Passwort"}</span>
            <input type="password" required value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} />
          </label>

          {!showAdvanced && (
            <button type="button" className="link-button" onClick={() => setShowAdvanced(true)}>
              Servereinstellungen anzeigen
            </button>
          )}

          {showAdvanced && (
            <div className="imap-advanced">
              <label className="imap-field">
                <span>IMAP-Server</span>
                <input type="text" required value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.beispiel.de" />
              </label>
              <div className="imap-field-row">
                <label className="imap-field">
                  <span>Port</span>
                  <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
                </label>
                <label className="imap-field imap-field-checkbox">
                  <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
                  <span>TLS</span>
                </label>
              </div>
              <label className="imap-field">
                <span>Nutzername (falls abweichend von der E-Mail-Adresse)</span>
                <input type="text" value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder={emailAddress || "optional"} />
              </label>
              <label className="imap-field">
                <span>SMTP-Server (optional)</span>
                <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder={imapHost || "optional"} />
              </label>
              <div className="imap-field-row">
                <label className="imap-field">
                  <span>SMTP-Port</span>
                  <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
                </label>
                <label className="imap-field imap-field-checkbox">
                  <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                  <span>TLS</span>
                </label>
              </div>
            </div>
          )}

          {submitError && <div className="onboarding-error">{submitError}</div>}

          <button type="submit" className="onboarding-button" disabled={submitting}>
            {submitting ? "Verbinde…" : "Verbinden"}
          </button>
        </form>
      </div>
    </div>
  );
}
