// [2026-09-21] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies" (WEB_INBOX.md
// 21.09.): sanitisiert den rohen, vom Provider gelieferten HTML-Koerper
// (MessageRecord.bodyHtml), BEVOR er den Client jemals erreicht -- Mail-HTML
// ist grundsaetzlich UNVERTRAUENSWUERDIGER Fremdinhalt (jeder Absender kann
// beliebiges HTML schicken), deshalb ein expliziter Allowlist-Ansatz statt
// eines Blocklist-Ansatzes: nur ausdruecklich erlaubte Tags/Attribute/
// URL-Schemes kommen durch, alles andere (Script/Iframe/Form/Object/Embed/
// Style-Bloecke/Event-Handler-Attribute/javascript:-URLs) wird entfernt.
//
// Wird bewusst NICHT beim Sync/Speichern angewendet, sondern erst hier, beim
// Ausliefern (siehe routes/messages.ts) -- zwei Gruende: (1) blockRemoteImages
// ist ein PRO-USER-Schalter (privacySettings), der sich nach dem Empfang der
// Mail aendern kann und dann auch fuer laengst synchronisierte Mails greifen
// soll; (2) ein spaeter gefundener Sanitizer-Bug/eine strengere Policy laesst
// sich so nachtraeglich fuer den gesamten Bestand fixen, ohne alle Mails neu
// synchronisieren zu muessen.

import sanitizeHtml from "sanitize-html";

export interface SanitizeMailHtmlOptions {
  /** [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 1 ("Tracking-Pixel-
   * Blockierung"): true = jedes <img src="http(s)://..."> verliert sein
   * src-Attribut (kein automatisches Nachladen -- der klassische
   * Tracking-Pixel-Angriffsweg). cid:-Inline-Bilder gibt es in dieser
   * Architektur nicht (kein MIME-Multipart-Auflösen eingebetteter Bilder),
   * betrifft also ausschliesslich echte Remote-URLs. */
  blockRemoteImages: boolean;
  /** [2026-09-21] "ZWEI ENTERPRISE-SICHERHEITS-FEATURES" Punkt 2
   * ("Klick-Zeit-Link-Pruefung"): Basis-URL von GET /link-check (z.B.
   * "http://localhost:3000/v1"), an die JEDER http(s)-Link umgeschrieben
   * wird -- macht den zuvor nur backend-seitig fertigen Endpunkt endlich im
   * echten Klick-Fluss erreichbar (vorher gab es dafuer ueberhaupt keine
   * anklickbaren Links im Client, siehe backend/README.md). `null`
   * (z.B. fehlende Konfiguration) = Links bleiben unveraendert, kein
   * Umschreiben ohne eine echte, erreichbare Basis-URL. */
  linkCheckBaseUrl: string | null;
}

// Bewusst KEIN <style>/<link>, kein "style"-Attribut auf beliebigen Tags:
// CSS `background: url(...)` ist derselbe Tracking-/Exfiltrations-Vektor
// wie ein <img src>, nur schwerer zu filtern -- einfacher, ihn komplett
// auszuschliessen, als eine sichere CSS-Teilmenge zu pflegen.
const ALLOWED_TAGS = [
  "a", "b", "strong", "i", "em", "u", "s", "strike", "p", "br", "hr",
  "ul", "ol", "li", "blockquote", "pre", "code", "span", "div",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "img", "font", "small", "sub", "sup",
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title"],
  img: ["src", "alt", "width", "height"],
  font: ["color"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

export function sanitizeMailHtml(html: string, opts: SanitizeMailHtmlOptions): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // Kein "data:" -- verhindert daten-eingebettete Tracking-/Exploit-Bilder
    // ueber <img src="data:...">, die sonst am Remote-Bild-Block vorbei
    // koennten (data: ist technisch kein Nachladen, aber genauso ein
    // moeglicher Payload-Transport). "mailto:" bleibt erlaubt (uebliche
    // "Antworten an eine andere Adresse"-Links in Mails).
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    // sanitize-html entfernt disallowte Tags standardmaessig samt Inhalt bei
    // <script>/<style> (discard), behaelt aber den TEXT-Inhalt bei allen
    // anderen nicht erlaubten Tags -- korrektes Verhalten hier: eine Mail
    // mit einem <blink>-Tag soll ihren sichtbaren Text behalten, nur das Tag
    // selbst verlieren.
    nonTextTags: ["script", "style", "iframe", "object", "embed", "form", "textarea", "noscript"],
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href;
        const isHttpLink = typeof href === "string" && /^https?:\/\//i.test(href);
        const rewrittenHref = isHttpLink && opts.linkCheckBaseUrl
          ? `${opts.linkCheckBaseUrl}/link-check?url=${encodeURIComponent(href)}`
          : href;
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(rewrittenHref ? { href: rewrittenHref } : {}),
            // Jeder Mail-Link oeffnet in einem neuen Tab -- ein Klick soll
            // nie die driftmail-Ansicht selbst ersetzen. noopener/noreferrer
            // verhindert `window.opener`-Zugriff der Zielseite (klassischer
            // Tabnabbing-Vektor), nofollow ist hier nur kosmetisch (kein
            // Suchmaschinen-Crawling betroffen), aber harmlos ergaenzt.
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        };
      },
      img: (tagName, attribs) => {
        const src = attribs.src;
        const isRemote = typeof src === "string" && /^https?:\/\//i.test(src);
        if (opts.blockRemoteImages && isRemote) {
          const { src: _dropped, ...rest } = attribs;
          return {
            tagName,
            attribs: {
              ...rest,
              alt: attribs.alt || "Bild blockiert (Tracking-Schutz)",
              "data-blocked-src": src,
            },
          };
        }
        return { tagName, attribs };
      },
    },
  });
}
