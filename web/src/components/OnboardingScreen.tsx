// OnboardingScreen — [2026-09-21] WEB_INBOX.md 19.09. "Onboarding: Provider-
// Auswahlbildschirm": ersetzt den bisherigen LoginScreen (der nur Gmail
// kannte) als Einstiegspunkt, solange kein Token vorhanden ist (App.tsx
// `if (!token)`-Gate). Rein lokaler State (kein Router im Projekt, siehe
// web/README.md):
//
// [2026-09-25] TERMINAL_INBOX.md 25.09. Punkt 1 ("Anbieter automatisch aus
// E-Mail-Adresse erkennen", WEB_INBOX.md 21.09., iOS-Referenz siehe
// ios/README.md 25.09.-Nachtrag): erster Schritt ist jetzt NUR die
// E-Mail-Adresse (EmailStep), kein Anbieter-Klick mehr nötig, bevor die
// Adresse überhaupt feststeht. Matching gegen MailProvider.domains (exakter
// Domain-Vergleich nach dem "@", kein Teilstring-Match). Drei Fälle wie bei
// iOS:
//   1. Bekannte, nutzbare Domain (authType imap/pop3, nicht comingSoon) ->
//      direkt weiter zu ImapConnectForm, Adresse vorbefüllt.
//   2. Bekannte, aber (noch) nicht nutzbare Domain (comingSoon, oder oauth
//      im addAccount-Modus) -> Hinweis mit Erklärung UND "Trotzdem per IMAP
//      versuchen"-Button (springt in denselben generischen IMAP-Fallback
//      wie Fall 3) -- keine Sackgasse. Gmail-oauth im normalen Login-Modus
//      ist auf Web (anders als iOS) echt nutzbar, siehe Fall 3.
//   3. Bekannte, nutzbare oauth-Domain (Gmail, nicht addAccount) -> Hinweis
//      mit echtem Google-Login-Link (kein automatischer Redirect ohne
//      Klick).
//   4. Unbekannte Domain -> direkt (ohne Fehlermeldung) zu "other_imap" mit
//      vorbefüllter Adresse.
// Der bisherige listenbasierte Auswahlbildschirm bleibt als sekundärer,
// manueller Weg erhalten ("Anbieter manuell auswählen").
//
// 2. IMAP-Formular: für alle authType="imap"/"pop3"-Provider (iCloud/GMX/
//    web.de/generisch), vorbefüllt aus dem gewählten MailProvider-Preset
//    (Host/Port/TLS) UND ggf. der bereits im ersten Schritt eingegebenen
//    Adresse. POST /accounts (provider=imap) verifiziert die Zugangsdaten
//    serverseitig per echtem IMAP-Login (siehe api-spec.yaml) -- 422 heißt
//    hier "falsche Adresse/falsches App-Passwort", nicht ein generischer
//    Netzwerkfehler.
//
// Fallback-Liste: falls GET /mail-providers (noch) nicht erreichbar ist
// (z.B. älterer Mock-Server ohne diese Route), bleibt wenigstens Gmail
// nutzbar, damit der Login-Weg nicht komplett blockiert.

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, googleLoginUrl, setStoredToken } from "../api";
import type { MailAccount, MailProvider } from "../types";
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
    domains: ["gmail.com", "googlemail.com"],
  },
];

// Generischer IMAP-Fallback für unbekannte Domains bzw. für den Fall, dass
// GET /mail-providers nicht erreichbar war (FALLBACK_PROVIDERS oben enthält
// bewusst nur Gmail) -- ohne dieses Objekt hätte eine unbekannte Domain in
// diesem Fehlerfall keinen Anschlusspunkt.
const OTHER_IMAP_FALLBACK: MailProvider = {
  id: "other_imap",
  label: "Anderer Anbieter (IMAP)",
  authType: "imap",
  comingSoon: false,
  imapHost: null,
  imapPort: 993,
  imapSecure: true,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  requiresAppPassword: false,
  appPasswordHelpUrl: null,
  domains: [],
};

export function OnboardingScreen({
  error,
  onConnected,
  mode = "login",
  onCancel,
  onAccountAdded,
}: {
  error: string | null;
  /** IMAP-Weg: kein Redirect, daher muss App.tsx den neuen Token selbst
   * übernehmen (Gmail-Weg braucht das nicht -- echter Redirect + Reload). */
  onConnected: (token: string) => void;
  /** [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): "login" ist
   * der bisherige Vollbild-Einstieg ohne Token, "addAccount" hängt (der
   * bereits gespeicherte Token wird von api.ts automatisch mitgeschickt)
   * ein weiteres Konto an den bereits eingeloggten User -- gleicher
   * Bildschirm, aber mit Abbrechen-Möglichkeit statt Vollbild-Gate, und
   * ohne Gmail (siehe dortiger Kommentar). */
  mode?: "login" | "addAccount";
  onCancel?: () => void;
  onAccountAdded?: (account: MailAccount) => void;
}) {
  const [providers, setProviders] = useState<MailProvider[]>(FALLBACK_PROVIDERS);
  const [providersError, setProvidersError] = useState(false);
  const [selected, setSelected] = useState<MailProvider | null>(null);
  const [prefillEmail, setPrefillEmail] = useState("");

  // [2026-09-25] Domain-Matching (siehe Kommentarblock oben): "email" ist
  // der neue Standard-Einstieg, "list" der bisherige manuelle Auswahlweg
  // (weiterhin erreichbar über "Anbieter manuell auswählen").
  const [step, setStep] = useState<"email" | "list">("email");
  const [emailInput, setEmailInput] = useState("");
  const [domainNotice, setDomainNotice] = useState<{ provider: MailProvider; kind: "oauth" | "unavailable" } | null>(null);

  useEffect(() => {
    api
      .listMailProviders()
      .then(setProviders)
      .catch(() => setProvidersError(true));
  }, []);

  function selectProvider(p: MailProvider) {
    if (p.comingSoon || p.authType === "oauth") return;
    setPrefillEmail("");
    setSelected(p);
  }

  function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = emailInput.trim();
    const domain = trimmed.split("@")[1]?.toLowerCase();
    if (!domain) return;
    const match = providers.find((p) => p.domains.includes(domain));
    if (!match) {
      // Unbekannte Domain -> ohne Fehlermeldung direkt in den generischen
      // IMAP-Fallback, Adresse durchgereicht (Fall 4).
      setPrefillEmail(trimmed);
      setSelected(providers.find((p) => p.id === "other_imap") ?? OTHER_IMAP_FALLBACK);
      return;
    }
    // Gleiche Einschränkung wie im bisherigen Listen-Weg unten: Gmail-OAuth
    // kann noch kein weiteres Konto an einen bestehenden Login anhängen.
    const unavailableForAddAccount = mode === "addAccount" && match.authType === "oauth" && !match.comingSoon;
    if (match.comingSoon || unavailableForAddAccount) {
      setDomainNotice({ provider: match, kind: "unavailable" });
      return;
    }
    if (match.authType === "oauth") {
      // Anders als bei iOS ist Gmail-OAuth auf Web echt nutzbar (kein
      // technischer Fallback nötig) -- trotzdem kein automatischer Redirect
      // ohne Klick, siehe Hinweis-Rendering unten (Fall 3).
      setDomainNotice({ provider: match, kind: "oauth" });
      return;
    }
    // Bekannte, nutzbare imap/pop3-Domain -> direkt ins Formular (Fall 1).
    setPrefillEmail(trimmed);
    setSelected(match);
  }

  function tryImapAnyway(provider: MailProvider) {
    setPrefillEmail(emailInput.trim());
    setDomainNotice(null);
    setSelected(providers.find((p) => p.id === "other_imap") ?? provider);
  }

  if (selected) {
    return (
      <ImapConnectForm
        provider={selected}
        initialEmail={prefillEmail}
        onBack={() => {
          setSelected(null);
          setPrefillEmail("");
        }}
        onConnected={onConnected}
        onAccountAdded={onAccountAdded}
      />
    );
  }

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        {mode === "addAccount" && onCancel && (
          <button type="button" className="onboarding-back" onClick={onCancel}>
            ← Abbrechen
          </button>
        )}
        <h1 className="onboarding-title">driftmail</h1>
        <p className="onboarding-subtitle">
          {mode === "addAccount" ? "Welches weitere Konto möchtest du verbinden?" : "Wähle dein E-Mail-Konto, um loszulegen."}
        </p>
        {error && <div className="onboarding-error">{ERROR_MESSAGES[error] ?? "Anmeldung fehlgeschlagen. Bitte erneut versuchen."}</div>}
        {providersError && (
          <div className="onboarding-hint">Anbieterliste konnte nicht geladen werden — Gmail ist trotzdem nutzbar.</div>
        )}

        {domainNotice ? (
          <div className="onboarding-domain-notice">
            {domainNotice.kind === "oauth" ? (
              <>
                <p className="onboarding-subtitle">
                  Diese Adresse gehört zu {domainNotice.provider.label}. Melde dich mit deinem Google-Konto an.
                </p>
                <a className="onboarding-button" href={googleLoginUrl()}>
                  Weiter mit Google
                </a>
              </>
            ) : (
              <>
                <p className="onboarding-subtitle">
                  {domainNotice.provider.comingSoon
                    ? `${domainNotice.provider.label} ist als eigener Anmeldeweg noch nicht verfügbar.`
                    : `${domainNotice.provider.label} kann aktuell nicht als weiteres Konto angehängt werden.`}
                </p>
                <button type="button" className="onboarding-button" onClick={() => tryImapAnyway(domainNotice.provider)}>
                  Trotzdem per IMAP versuchen
                </button>
              </>
            )}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setDomainNotice(null);
                setEmailInput("");
              }}
            >
              ← Andere Adresse
            </button>
          </div>
        ) : step === "email" ? (
          <>
            <form className="imap-form" onSubmit={handleEmailSubmit}>
              <label className="imap-field">
                <span>E-Mail-Adresse</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="du@beispiel.de"
                />
              </label>
              <button type="submit" className="onboarding-button">
                Weiter
              </button>
            </form>
            <button type="button" className="link-button" onClick={() => setStep("list")}>
              Anbieter manuell auswählen
            </button>
          </>
        ) : (
          <>
            <button type="button" className="link-button" onClick={() => setStep("email")}>
              ← Zurück zur E-Mail-Eingabe
            </button>
            <div className="provider-grid">
              {providers.map((p) => {
                // [2026-09-21] Mehrfach-Konten: Gmail-OAuth unterstützt das
                // Anhängen an einen bereits eingeloggten User noch nicht --
                // GET /auth/google/callback redirected immer zu einem
                // einzigen FRONTEND_URL, ohne den bestehenden Login-Zustand
                // durch den Redirect durchzureichen (siehe backend/README.md
                // "Mehrfach-Konten-Unterstützung", Offene Frage an Track A).
                // Deshalb hier bewusst deaktiviert statt einen kaputten/
                // verwirrenden Flow zu starten, der den aktuellen Login
                // stillschweigend ersetzen könnte.
                const gmailUnavailableForAddAccount = mode === "addAccount" && p.authType === "oauth" && !p.comingSoon;
                const disabled = p.comingSoon || gmailUnavailableForAddAccount;
                const cardContent = (
                  <>
                    <span className="provider-label">{p.label}</span>
                    <span className="provider-meta">
                      {p.comingSoon
                        ? "demnächst"
                        : gmailUnavailableForAddAccount
                          ? "noch nicht für weitere Konten"
                          : p.authType === "oauth"
                            ? "Anmelden"
                            : "IMAP verbinden"}
                    </span>
                  </>
                );
                // Gmail (authType=oauth, nicht comingSoon, nicht addAccount-
                // Modus): echter Browser-Redirect per <a href>, kein
                // programmatischer window.location-Sprung -- kein `fetch`,
                // das wäre für einen Redirect zu Google falsch.
                if (!p.comingSoon && p.authType === "oauth" && !gmailUnavailableForAddAccount) {
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
                    className={`provider-card${disabled ? " coming-soon" : ""}`}
                    onClick={() => selectProvider(p)}
                    disabled={disabled}
                  >
                    {cardContent}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ImapConnectForm({
  provider,
  initialEmail = "",
  onBack,
  onConnected,
  onAccountAdded,
}: {
  provider: MailProvider;
  /** [2026-09-25] Domain-Matching: Adresse steht durch den EmailStep davor
   * meist schon fest -- kein erneutes Eintippen nötig. Leer beim manuellen
   * Listen-Weg (dort ist die Adresse noch nicht bekannt). */
  initialEmail?: string;
  onBack: () => void;
  onConnected: (token: string) => void;
  onAccountAdded?: (account: MailAccount) => void;
}) {
  const [emailAddress, setEmailAddress] = useState(initialEmail);
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
      if (onAccountAdded) {
        onAccountAdded(res.account);
      } else {
        onConnected(res.token);
      }
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
