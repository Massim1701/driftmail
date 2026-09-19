import { getHeader } from "./headers.js";

// Startliste bekannter Markennamen, die haeufig in Phishing-Anzeigenamen
// missbraucht werden (WEB_INBOX.md 15.09., "Anzeigename-Spoofing-
// Erkennung"). Bewusst nicht erschoepfend -- muss laut Auftrag nicht
// vollstaendig sein, eine Produktionsversion sollte diese Liste laufend
// erweitern bzw. durch einen echten Markendatenbank-Abgleich ersetzen.
const KNOWN_BRANDS: Array<{ name: string; domains: string[] }> = [
  { name: "paypal", domains: ["paypal.com", "paypal.de"] },
  { name: "amazon", domains: ["amazon.com", "amazon.de"] },
  { name: "apple", domains: ["apple.com", "icloud.com"] },
  { name: "microsoft", domains: ["microsoft.com", "outlook.com", "live.com"] },
  { name: "google", domains: ["google.com", "gmail.com"] },
  { name: "sparkasse", domains: ["sparkasse.de"] },
  { name: "deutsche bank", domains: ["deutsche-bank.de", "db.com"] },
  { name: "volksbank", domains: ["volksbank.de"] },
  { name: "postbank", domains: ["postbank.de"] },
  { name: "dhl", domains: ["dhl.com", "dhl.de"] },
  { name: "netflix", domains: ["netflix.com"] },
  { name: "ing", domains: ["ing.de"] },
];

function domainBelongsToBrand(domain: string, brandDomains: string[]): boolean {
  return brandDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Extrahiert Anzeigename + Absenderdomain aus dem "From"-Header
 * ("PayPal Support <support@paypal-security-check.example>" ->
 * {displayName: "PayPal Support", domain: "paypal-security-check.example"}).
 * Gleiches Parsing-Muster wie `extractSenderDomain` in heloMismatch.ts,
 * hier zusaetzlich um den Anzeigenamen-Teil erweitert.
 */
function parseFromHeader(headers: Record<string, string>): { displayName: string; domain: string | null } {
  const from = getHeader(headers, "From") ?? "";
  const angleMatch = from.match(/<([^>]+)>/);
  const address = angleMatch?.[1] ?? from;
  const domainMatch = address.match(/@([a-z0-9.-]+\.[a-z]{2,24})/i);
  const displayName = angleMatch ? from.slice(0, angleMatch.index).trim().replace(/^"|"$/g, "") : "";
  return { displayName, domain: domainMatch?.[1]?.toLowerCase() ?? null };
}

/**
 * Erkennt Anzeigename-Spoofing: ein bekannter Markenname taucht im
 * Absender-Anzeigenamen auf, aber die tatsaechliche Absenderdomain gehoert
 * nicht zu dieser Marke (WEB_INBOX.md 15.09.). Aehnliches Muster wie
 * `detectHomoglyphs` -- Text-/Header-Abgleich, kein Netzwerkzugriff.
 *
 * Ohne Anzeigename (nur eine nackte Adresse als "From") kein Signal --
 * ein fehlender Anzeigename ist per se nicht verdaechtig.
 */
export function detectDisplayNameSpoofing(headers: Record<string, string>): boolean {
  const { displayName, domain } = parseFromHeader(headers);
  if (!displayName || !domain) return false;

  const nameLower = displayName.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (nameLower.includes(brand.name) && !domainBelongsToBrand(domain, brand.domains)) {
      return true;
    }
  }
  return false;
}
