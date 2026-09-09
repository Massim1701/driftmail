import { getHeader } from "./headers.js";
import type { AuthStatus } from "./types.js";

export type { AuthStatus };

// Ergebniswerte, die laut RFC 8601 als "fail-artig" gelten -- alles außer
// "pass" wird konservativ als Fehlschlag behandelt, weil driftmail lieber
// zu vorsichtig als zu gutgläubig sein soll.
const FAIL_LIKE = new Set([
  "fail",
  "softfail",
  "permerror",
  "temperror",
  "neutral",
  "policy",
  "discard",
]);

function normalizeResult(value: string | undefined): AuthStatus {
  if (!value) return "none";
  const v = value.toLowerCase();
  if (v === "pass") return "pass";
  if (FAIL_LIKE.has(v)) return "fail";
  return "none";
}

interface RawAuthVerdicts {
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

/**
 * Parst den aggregierten "Authentication-Results"-Header (RFC 8601), den
 * praktisch jeder empfangende Mailserver (Gmail, Outlook, ...) setzt, z.B.:
 *
 *   Authentication-Results: mx.google.com;
 *     spf=pass smtp.mailfrom=example.com;
 *     dkim=pass header.d=example.com;
 *     dmarc=pass action=none header.from=example.com
 *
 * Annahme: Es gibt genau einen vertrauenswürdigen Authentication-Results-
 * Header (vom letzten empfangenden Server gesetzt). Mehrere Hops mit
 * mehreren Authentication-Results-Headern sauber zu priorisieren ist ein
 * bekanntes Problem in echten Implementierungen -- hier nicht gelöst, siehe
 * README "Bekannte Lücken".
 */
function parseAuthenticationResults(headerValue: string | undefined): RawAuthVerdicts {
  if (!headerValue) return {};
  const result: RawAuthVerdicts = {};
  const spfMatch = headerValue.match(/\bspf=([a-zA-Z]+)/i);
  const dkimMatch = headerValue.match(/\bdkim=([a-zA-Z]+)/i);
  const dmarcMatch = headerValue.match(/\bdmarc=([a-zA-Z]+)/i);
  if (spfMatch) result.spf = spfMatch[1];
  if (dkimMatch) result.dkim = dkimMatch[1];
  if (dmarcMatch) result.dmarc = dmarcMatch[1];
  return result;
}

export interface AuthHeaderResult {
  spfStatus: AuthStatus;
  dkimStatus: AuthStatus;
  dmarcStatus: AuthStatus;
}

/**
 * Bestimmt SPF/DKIM/DMARC-Status aus den Mail-Headern.
 *
 * Primärquelle: der aggregierte "Authentication-Results"-Header.
 * Fallback für SPF: der ältere, separate "Received-SPF"-Header, den manche
 * MTAs zusätzlich setzen.
 *
 * Für DKIM gibt es bewusst KEINEN Fallback auf die reine Anwesenheit eines
 * "DKIM-Signature"-Headers: die Signatur-Header zeigt nur, dass der
 * Absender eine Signatur *behauptet*, nicht dass sie geprüft und gültig ist.
 * Ohne eine Verifikationsaussage (aus Authentication-Results) bleibt der
 * Status "none" statt fälschlich "pass".
 */
export function parseAuthHeaders(headers: Record<string, string>): AuthHeaderResult {
  const authResults = getHeader(headers, "Authentication-Results");
  const parsed = parseAuthenticationResults(authResults);

  const receivedSpf = getHeader(headers, "Received-SPF");
  const spfFallback = receivedSpf ? receivedSpf.trim().split(/\s+/)[0] : undefined;

  return {
    spfStatus: normalizeResult(parsed.spf ?? spfFallback),
    dkimStatus: normalizeResult(parsed.dkim),
    dmarcStatus: normalizeResult(parsed.dmarc),
  };
}
