import { getHeader } from "./headers.js";

/** Extrahiert die Domain einer E-Mail-Adresse aus einem Header-Wert, egal
 * ob mit oder ohne Display-Name/spitze Klammern -- gleiches Parsing-Muster
 * wie `extractSenderDomain` in heloMismatch.ts. */
function extractDomain(headerValue: string): string | null {
  const angleMatch = headerValue.match(/<([^>]+)>/);
  const address = angleMatch?.[1] ?? headerValue;
  const domainMatch = address.match(/@([a-z0-9.-]+\.[a-z]{2,24})/i);
  return domainMatch?.[1]?.toLowerCase() ?? null;
}

// Gleiche "verwandte Domains"-Logik wie in linkMismatch.ts/heloMismatch.ts
// (Subdomain in beide Richtungen erlaubt, kein Mismatch) -- z.B.
// "notifications@mail.firma.de" mit Reply-To "support@firma.de" ist eine
// haeufige, legitime Konstellation (Massenversand-Subdomain), kein BEC-Trick.
function domainsAreRelated(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Erkennt Reply-To-Mismatch (WEB_INBOX.md 15.09., "6 Sicherheits-
 * Ergaenzungen" Punkt 2): Reply-To-Header vorhanden UND dessen Domain
 * weicht von der From-Domain ab -- klassischer BEC-Trick (Antworten gehen
 * an eine andere Adresse als die sichtbare Absenderadresse).
 *
 * Ohne Reply-To-Header kein Signal (die meisten Mails haben keinen, das ist
 * normal). Nur der DOMAIN-Vergleich zaehlt, nicht die volle Adresse -- ein
 * anderer lokaler Teil auf derselben Domain (z.B. "no-reply@" vs.
 * "support@" bei derselben Firma) ist ueblich und nicht verdaechtig.
 */
export function detectReplyToMismatch(headers: Record<string, string>): boolean {
  const replyToHeader = getHeader(headers, "Reply-To");
  if (!replyToHeader) return false;

  const fromHeader = getHeader(headers, "From") ?? "";
  const fromDomain = extractDomain(fromHeader);
  const replyToDomain = extractDomain(replyToHeader);
  if (!fromDomain || !replyToDomain) return false;

  return !domainsAreRelated(fromDomain, replyToDomain);
}
