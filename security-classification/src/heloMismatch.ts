import { getHeader } from "./headers.js";

// Grobe IP-Literal-Erkennung (IPv4 sowie [gebrackete] IPv4/IPv6), um sie von
// echten Hostnamen zu unterscheiden. Kein vollständiger IPv6-Parser, deckt
// aber die in "Received"-Headern praktisch immer vorkommenden Formen ab.
function isIpLiteral(token: string): boolean {
  const stripped = token.replace(/^\[/, "").replace(/\]$/, "");
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(stripped)) return true;
  if (stripped.includes(":") && /^[0-9a-f:]+$/i.test(stripped)) return true;
  return false;
}

/**
 * Extrahiert den vom sendenden Client behaupteten HELO/EHLO-Hostnamen aus
 * einem einzelnen "Received"-Header-Wert. Beispiele, die das abdeckt:
 *
 *   Received: from mail.example.com (mail.example.com [203.0.113.5]) by ...
 *   Received: from [203.0.113.7] (EHLO webmail.example.ru) by ...
 *   Received: from bad-host.example (unknown [203.0.113.9]) by ...
 *
 * Priorität: ein explizites "(HELO xxx)"/"(EHLO xxx)" in Klammern (das ist
 * der wörtlichste Beleg, den ein MTA für den behaupteten Namen mitgibt),
 * sonst der erste Token nach "from" sofern er kein reines IP-Literal ist,
 * sonst ein Hostname aus dem Klammerteil (z.B. rDNS-Name vor der IP).
 * Liefert `null`, wenn sich kein Hostname finden lässt (z.B. nur eine
 * nackte IP ohne jede Namensangabe).
 */
function extractHeloHost(received: string): string | null {
  const explicit = received.match(/\((?:HELO|EHLO)\s+([^\s)]+)\)/i);
  if (explicit?.[1]) return explicit[1].toLowerCase();

  const fromMatch = received.match(/^\s*from\s+(\S+)/i);
  if (fromMatch?.[1]) {
    const token = fromMatch[1].replace(/[,;]+$/, "");
    if (!isIpLiteral(token)) return token.toLowerCase();
  }

  const parenHost = received.match(/\(([a-z0-9.-]+\.[a-z]{2,24})\s*\[/i);
  if (parenHost?.[1]) return parenHost[1].toLowerCase();

  return null;
}

/**
 * Extrahiert die Absenderdomain aus dem "From"-Header (Teil nach "@" der
 * enthaltenen E-Mail-Adresse, egal ob mit oder ohne Display-Name/spitze
 * Klammern).
 */
function extractSenderDomain(headers: Record<string, string>): string | null {
  const from = getHeader(headers, "From");
  if (!from) return null;
  const angleMatch = from.match(/<([^>]+)>/);
  const address = angleMatch?.[1] ?? from;
  const atMatch = address.match(/@([a-z0-9.-]+\.[a-z]{2,24})/i);
  return atMatch?.[1] ? atMatch[1].toLowerCase() : null;
}

// Gleiche "verwandte Domains"-Logik wie in linkMismatch.ts (Subdomain in
// beide Richtungen erlaubt, kein Mismatch).
function domainsAreRelated(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Näherung für einen HELO/EHLO-Mismatch: vergleicht den behaupteten
 * HELO/EHLO-Hostnamen aus dem "Received"-Header mit der Absenderdomain aus
 * "From". Klassisches Botnetz-Merkmal laut WEB_INBOX.md 08.09.
 * ("Botnetz-Erkennungssignale") -- echte Mailserver sind darin konsistent.
 *
 * WICHTIG -- das ist KEIN echter Reverse-DNS-Abgleich: ein echter
 * HELO-Mismatch-Check prüft, ob die Reverse-DNS-Auflösung (PTR-Record) der
 * sendenden IP zum behaupteten HELO-Namen passt. Das braucht einen
 * DNS-Lookup (Netzwerkzugriff), den dieses zustandslose Text+Header-Modul
 * nicht hat. Stattdessen: eine schwächere, aber ehrliche String-Heuristik
 * -- "passt der behauptete HELO-Hostname halbwegs zur Absenderdomain".
 *
 * Liefert `false` (kein Signal, NICHT "kein Mismatch bestätigt") wenn:
 *  - kein "Received"-Header vorhanden ist,
 *  - sich aus dem Header kein Hostname extrahieren lässt (z.B. nur eine
 *    nackte IP ohne HELO/EHLO-Angabe),
 *  - sich aus "From" keine Absenderdomain extrahieren lässt.
 *
 * Bekannter, erwartbarer False-Positive-Fall: legitime Mails, die über
 * einen Drittanbieter-Versanddienst laufen (Google Workspace, Mailchimp,
 * SendGrid, Newsletter-Tools, ...) haben typischerweise einen
 * HELO-Hostnamen auf einer komplett anderen Domain als der Absender -- das
 * ist normal und KEIN Botnetz-Indiz. Diese Heuristik allein reicht daher
 * nicht für eine automatische Entscheidung ("kein einzelnes Signal reicht
 * allein aus", siehe WEB_INBOX.md 08.09.).
 *
 * Bekannte Grenze bei mehreren "Received"-Headern (mehrere Hops): der
 * Contract übergibt Header als `Record<string, string>` (ein Wert pro
 * Schlüssel) -- es kann also ohnehin nur der eine "Received"-Wert ankommen,
 * den der Aufrufer unter diesem Schlüssel bereitstellt. Mehrere Hops
 * sauber zu priorisieren (z.B. den relevantesten/äußersten Hop auswählen)
 * ist hier nicht gelöst, analog zur bestehenden
 * Authentication-Results-Einschränkung in `authHeaders.ts`.
 */
export function detectHeloMismatch(headers: Record<string, string>): boolean {
  const received = getHeader(headers, "Received");
  if (!received) return false;

  const heloHost = extractHeloHost(received);
  if (!heloHost) return false;

  const senderDomain = extractSenderDomain(headers);
  if (!senderDomain) return false;

  return !domainsAreRelated(heloHost, senderDomain);
}
