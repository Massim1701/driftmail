// Allowlist fuer echte Zugriffskontrolle bei der Anmeldung (WEB_INBOX.md
// 10.09. "Antwort auf die zwei Fragen zu Auth", Punkt 2: Massimo will fuer
// v1 keine freie Registrierung, sondern nur sich selbst + ausgewaehlte
// Tester). Greift an JEDER Stelle, an der ein User erstmalig entsteht
// (POST /accounts UND GET /auth/google/callback) -- sonst waere die
// Allowlist nur eine halbe Absicherung.
//
// Zero-Config-Fallback (gleiches Muster wie Gmail/IMAP vs. Fixture-Adapter
// und DATABASE_URL vs. In-Memory-Store, siehe backend/README.md): ist
// ALLOWED_EMAILS nicht gesetzt, ist jede Adresse erlaubt -- praktisch fuer
// lokale Entwicklung/den Smoketest, aber MUSS vor einem echten, oeffentlich
// erreichbaren Deploy gesetzt werden. Kein DB-Table (wie in der Antwort als
// Alternative genannt), weil eine feste, von Massimo per Hand gepflegte
// Handvoll Adressen kein Laufzeit-CRUD braucht -- ein Server-Neustart nach
// Aenderung der Env-Var ist fuer diesen Zweck ausreichend.

function parseAllowlist(raw: string | undefined): Set<string> | null {
  if (!raw || raw.trim() === "") return null;
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export function isEmailAllowed(email: string): boolean {
  const allowlist = parseAllowlist(process.env.ALLOWED_EMAILS);
  if (allowlist === null) return true; // nicht konfiguriert -> Dev-Fallback, siehe Kopfkommentar
  return allowlist.has(email.trim().toLowerCase());
}
