// LoginScreen — [2026-09-10] echter Google-Login (backend/README.md "Echter
// Google-Login"): ersetzt die bisherige implizite Demo-Anmeldung. Der
// eigentliche OAuth-Flow läuft komplett serverseitig (GET
// /auth/google/start -> Google -> GET /auth/google/callback) -- dieser
// Screen navigiert per echtem Browser-Redirect dorthin (kein `fetch`, das
// wäre für einen Redirect zu Google falsch), App.tsx übernimmt danach den
// Token aus /auth/callback.

import { googleLoginUrl } from "../api";
import "./LoginScreen.css";

// Fehlercodes aus GET /auth/google/callback (backend/README.md "Echter
// Google-Login") -- verständliche deutsche Meldung statt des rohen Codes.
const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "Google-Anmeldung ist auf diesem Server noch nicht konfiguriert.",
  missing_code: "Anmeldung bei Google wurde abgebrochen oder ist fehlgeschlagen.",
  token_exchange_failed: "Anmeldung bei Google ist fehlgeschlagen. Bitte erneut versuchen.",
  userinfo_failed: "Kontodaten konnten nicht von Google abgerufen werden.",
  email_not_verified: "Diese Google-Adresse ist nicht verifiziert.",
  not_allowlisted: "Diese E-Mail-Adresse ist für driftmail (noch) nicht freigeschaltet.",
};

export function LoginScreen({ error }: { error: string | null }) {
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1 className="login-title">driftmail</h1>
        <p className="login-subtitle">Melde dich mit deinem Google-Konto an.</p>
        {error && <div className="login-error">{ERROR_MESSAGES[error] ?? "Anmeldung fehlgeschlagen. Bitte erneut versuchen."}</div>}
        <a className="login-button" href={googleLoginUrl()}>
          Mit Google anmelden
        </a>
      </div>
    </div>
  );
}
