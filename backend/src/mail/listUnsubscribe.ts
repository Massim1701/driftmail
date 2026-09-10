// RFC 8058 / RFC 2369 List-Unsubscribe-Header-Parsing (WEB_INBOX.md 09.09.
// "Automatisches Abmelden bei Spam"). NIE Klick auf Links im Mail-BODY --
// nur dieser Header, vom Absender selbst gesetzt, ist der sichere
// Abmelde-Mechanismus (unverändert seit der ursprünglichen Unsubscribe-
// Regel, siehe db-schema.sql "Unsubscribe (nur RFC 8058, nie Body-Link)").
//
// Format: eine kommaseparierte Liste von URIs in spitzen Klammern, z.B.
//   List-Unsubscribe: <mailto:unsub@example.com>, <https://example.com/u?id=1>
//
// Grenze (erster Durchstich, siehe backend/README.md "Automatische
// Abmeldung bei Spam"): nur Syntax-Validierung (mailto:/http(s):-Schema
// vorhanden). Kein Zustellungs-Nachweis, keine echte E-Mail/HTTP-POST an
// die gefundene Adresse/URL -- das wäre ein echter Netzwerk-Seiteneffekt
// mit eigenen Sicherheitsimplikationen (u.a. SSRF-Risiko bei beliebigen
// Absender-URLs) und bewusst nicht Teil dieses Schritts. Ebenfalls bewusst
// nicht geprüft: der optionale `List-Unsubscribe-Post`-Header aus RFC 8058
// (bestätigt, dass der Absender den sicheren One-Click-POST-Mechanismus
// unterstützt) -- eine strengere Implementierung würde das für den
// automatischen Pfad zusätzlich verlangen.

export interface ParsedListUnsubscribe {
  /** Der vollständige, unveränderte Header-Wert -- wird 1:1 in
   * unsubscribe_actions.list_unsubscribe_header_value gespeichert. */
  raw: string;
  mailto: string | null;
  url: string | null;
}

const URI_PATTERN = /<([^>]+)>/g;

/** `null`, wenn kein (syntaktisch gültiger) List-Unsubscribe-Header
 * vorhanden ist -- weder ein `mailto:` noch ein `http(s):`-Ziel gefunden. */
export function parseListUnsubscribeHeader(rawHeaders: Record<string, string> | null | undefined): ParsedListUnsubscribe | null {
  if (!rawHeaders) return null;
  const headerKey = Object.keys(rawHeaders).find((k) => k.toLowerCase() === "list-unsubscribe");
  if (!headerKey) return null;
  const value = rawHeaders[headerKey];
  if (!value || !value.trim()) return null;

  let mailto: string | null = null;
  let url: string | null = null;
  URI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URI_PATTERN.exec(value)) !== null) {
    const uri = match[1].trim();
    const lower = uri.toLowerCase();
    if (lower.startsWith("mailto:")) mailto = uri;
    else if (lower.startsWith("http://") || lower.startsWith("https://")) url = uri;
  }

  if (!mailto && !url) return null;
  return { raw: value, mailto, url };
}
