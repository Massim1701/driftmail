// RFC 8058 / RFC 2369 List-Unsubscribe-Header-Parsing + echter Abmelde-
// Aufruf (WEB_INBOX.md 09.09. "Automatisches Abmelden bei Spam", Dispatch
// nachgezogen WEB_INBOX.md 21.09. "LUECKE SCHLIESSEN - echter Abmelde-
// Aufruf"). NIE Klick auf Links im Mail-BODY -- nur dieser Header, vom
// Absender selbst gesetzt, ist der sichere Abmelde-Mechanismus
// (unverändert seit der ursprünglichen Unsubscribe-Regel, siehe
// db-schema.sql "Unsubscribe (nur RFC 8058, nie Body-Link)").
//
// Format: eine kommaseparierte Liste von URIs in spitzen Klammern, z.B.
//   List-Unsubscribe: <mailto:unsub@example.com>, <https://example.com/u?id=1>
//
// [2026-09-21] Nachtrag: bis zu diesem Schritt nur Syntax-Validierung
// (mailto:/http(s):-Schema vorhanden), OHNE echten Zustellungs-Nachweis --
// status wurde blind auf 'confirmed' gesetzt, ohne dass je eine E-Mail
// verschickt oder ein HTTP-Request ausgelöst wurde. `performUnsubscribe()`
// unten schliesst das: echter Versand (mailto:, über den bestehenden
// Provider-Sende-Mechanismus -- kein eigener SMTP-Client nötig) bzw. echter
// HTTP-Request (https:, GET oder POST je nachdem ob List-Unsubscribe-Post
// vorhanden ist, RFC 8058 "One-Click"). Sicherheitsbewusst: kein Folgen von
// Redirects auf eine ANDERE Domain als die ursprüngliche URL (ein Absender
// könnte sonst über eine Redirect-Kette auf beliebige interne/fremde Ziele
// zeigen -- SSRF-artiges Risiko), begrenzte Hop-Zahl, kurzes Timeout, damit
// ein hängender Server nicht den Mail-Sync blockiert.

export interface ParsedListUnsubscribe {
  /** Der vollständige, unveränderte Header-Wert -- wird 1:1 in
   * unsubscribe_actions.list_unsubscribe_header_value gespeichert. */
  raw: string;
  mailto: string | null;
  url: string | null;
  /** RFC 8058 List-Unsubscribe-Post-Header vorhanden (Wert ist laut RFC
   * immer die feste Zeichenkette "List-Unsubscribe=One-Click") -- bestätigt,
   * dass der Absender den sicheren One-Click-POST-Mechanismus unterstützt.
   * Steuert bei performUnsubscribe() GET vs. POST für `url`. */
  oneClickPost: boolean;
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

  const postHeaderKey = Object.keys(rawHeaders).find((k) => k.toLowerCase() === "list-unsubscribe-post");
  const oneClickPost = !!postHeaderKey && !!rawHeaders[postHeaderKey]?.trim();

  return { raw: value, mailto, url, oneClickPost };
}

export interface UnsubscribeDispatchResult {
  status: "confirmed" | "failed";
  error?: string;
}

const HTTP_TIMEOUT_MS = 8000;
const MAX_REDIRECT_HOPS = 3;

/** RFC 6068 mailto-URI: Adresse + optionale Query-Parameter (subject=/body=). */
function parseMailtoUri(uri: string): { address: string; subject: string | null } {
  const withoutScheme = uri.slice("mailto:".length);
  const [address, query] = withoutScheme.split("?", 2);
  const subject = query ? new URLSearchParams(query).get("subject") : null;
  return { address: decodeURIComponent(address), subject };
}

async function dispatchHttpUnsubscribe(startUrl: string, oneClickPost: boolean): Promise<UnsubscribeDispatchResult> {
  let currentUrl = startUrl;
  let originalHost: string;
  try {
    originalHost = new URL(startUrl).hostname;
  } catch {
    return { status: "failed", error: `ungültige URL: ${startUrl}` };
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: oneClickPost ? "POST" : "GET",
        headers: oneClickPost ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        body: oneClickPost ? "List-Unsubscribe=One-Click" : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { status: "failed", error: `Redirect (${res.status}) ohne Location-Header` };
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return { status: "failed", error: `ungültiges Redirect-Ziel: ${location}` };
      }
      // Sicherheitsbewusste Grenze (WEB_INBOX.md 21.09.): kein automatisches
      // Folgen von Redirects auf eine andere Domain als die ursprüngliche
      // List-Unsubscribe-URL.
      if (nextUrl.hostname !== originalHost) {
        return { status: "failed", error: `Redirect auf fremde Domain abgelehnt (${nextUrl.hostname})` };
      }
      currentUrl = nextUrl.toString();
      continue;
    }

    if (res.status >= 200 && res.status < 300) return { status: "confirmed" };
    return { status: "failed", error: `HTTP ${res.status} von ${currentUrl}` };
  }
  return { status: "failed", error: "zu viele Redirects" };
}

/** Führt den echten Abmelde-Aufruf aus. `sendMail` ist absichtlich nur die
 * eine benötigte Funktion aus `MailAdapter` (nicht der ganze Adapter) --
 * hält diese Datei unabhängig von mail/types.ts, keine Zirkel-Importe. */
export async function performUnsubscribe(
  parsed: ParsedListUnsubscribe,
  sendMail: (input: { to: string[]; subject: string; bodyText: string }) => Promise<unknown>,
): Promise<UnsubscribeDispatchResult> {
  try {
    if (parsed.mailto) {
      const { address, subject } = parseMailtoUri(parsed.mailto);
      await sendMail({ to: [address], subject: subject ?? "unsubscribe", bodyText: "unsubscribe" });
      return { status: "confirmed" };
    }
    if (parsed.url) {
      return await dispatchHttpUnsubscribe(parsed.url, parsed.oneClickPost);
    }
    return { status: "failed", error: "kein mailto:/https:-Ziel im List-Unsubscribe-Header" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
