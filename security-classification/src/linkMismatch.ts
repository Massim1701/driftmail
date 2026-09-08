export interface ExtractedLink {
  displayText: string;
  actualUrl: string;
}

function hostnameOf(url: string): string | null {
  try {
    const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `http://${url}`;
    const u = new URL(normalized);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractDomainLikeTokens(text: string): string[] {
  const regex = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;
  const matches = text.match(regex) ?? [];
  return matches.map((m) => m.toLowerCase().replace(/^www\./, ""));
}

/**
 * Extrahiert Link-Paare (Anzeigetext, tatsächliches Ziel) aus HTML-Mails
 * (`<a href="...">Text</a>`) und aus Markdown-artigem Text (`[Text](url)`),
 * falls die Mail als reiner Text mit solchen Links vorliegt (z.B. manche
 * Mailclients/Weiterleitungen). Ohne HTML- oder Markdown-Struktur (reiner
 * Fließtext mit einer nackten URL) gibt es keinen Anzeigetext zum
 * Vergleichen -- solche Links liefern kein Mismatch-Signal, siehe README.
 */
export function extractLinks(rawText: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];

  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(rawText)) !== null) {
    const href = match[1]?.trim();
    const display = match[2]?.replace(/<[^>]+>/g, "").trim();
    if (href && display) links.push({ displayText: display, actualUrl: href });
  }

  const markdownRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  while ((match = markdownRegex.exec(rawText)) !== null) {
    const display = match[1]?.trim();
    const href = match[2]?.trim();
    if (href && display) links.push({ displayText: display, actualUrl: href });
  }

  return links;
}

function domainsAreRelated(a: string, b: string): boolean {
  if (a === b) return true;
  // Subdomain-Beziehung in beide Richtungen erlauben (z.B. "mail.example.com"
  // vs. "example.com" gilt nicht als Mismatch).
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Klassischer Phishing-Indikator: Anzeigetext eines Links behauptet eine
 * Domain ("www.paypal.com"), das tatsächliche href-Ziel zeigt aber auf eine
 * andere Domain ("paypal-verify.example-evil.ru").
 *
 * Nur Links, deren Anzeigetext selbst wie eine Domain/URL aussieht, werden
 * verglichen -- ein Link mit Anzeigetext "Hier klicken" liefert keine
 * vergleichbare Domain und wird übersprungen (kein Fehlalarm, aber auch
 * kein Signal).
 */
export function detectLinkMismatch(rawText: string): boolean {
  const links = extractLinks(rawText);
  for (const link of links) {
    const actualHost = hostnameOf(link.actualUrl);
    if (!actualHost) continue;

    const displayDomains = extractDomainLikeTokens(link.displayText);
    for (const displayDomain of displayDomains) {
      if (!domainsAreRelated(displayDomain, actualHost)) {
        return true;
      }
    }
  }
  return false;
}
