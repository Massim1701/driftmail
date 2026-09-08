// Grobe Erkennung, ob rawText überhaupt HTML-Markup enthält (nicht nur ein
// zufälliges "<" im Fließtext, z.B. "5 < 10").
const HTML_TAG_REGEX = /<([a-z][a-z0-9]*)\b[^>]*>/i;
const IMG_TAG_REGEX = /<img\b[^>]*>/gi;
const SCRIPT_OR_STYLE_REGEX = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ANY_TAG_REGEX = /<[^>]+>/g;
const HTML_ENTITY_REGEX = /&[a-z]+;|&#\d+;/gi;

/**
 * Entfernt Script/Style-Blöcke und alle Tags, liefert nur den sichtbaren
 * Text. Keine vollständige HTML-Entity-Dekodierung (z.B. "&auml;" bleibt
 * als Platzhalter-Leerzeichen statt "ä") -- für die reine Wortzählung hier
 * ausreichend, siehe README "Bekannte Lücken".
 */
function stripHtml(html: string): string {
  return html
    .replace(SCRIPT_OR_STYLE_REGEX, " ")
    .replace(ANY_TAG_REGEX, " ")
    .replace(HTML_ENTITY_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Schätzt den Bild-zu-Text-Anteil einer Mail: Anzahl `<img>`-Tags im
 * Verhältnis zur sichtbaren Textmenge (Wortanzahl nach Entfernen aller
 * Tags). Bekannte Umgehungstaktik gegen Text-Filter: Werbetext steckt
 * komplett in einem Bild statt im durchsuchbaren Text (siehe WEB_INBOX.md
 * 08.09., "Botnetz-Erkennungssignale").
 *
 * Formel: `imageCount / (imageCount + textWordCount)` -- 0.0 bedeutet
 * "kein Bild, nur Text", 1.0 bedeutet "nur Bilder, kein Fließtext". Das ist
 * eine ECHTE, deterministische Berechnung (kein Platzhalter), aber eine
 * bewusst einfache Näherung, keine echte Bildflächen-/Pixelanalyse:
 *
 *  - Zählt nur `<img>`-Tags, keine per CSS `background-image` eingebundenen
 *    Bilder.
 *  - Misst Textmenge in Wörtern nach Tag-Entfernung, nicht in tatsächlicher
 *    Bildfläche (Bilder werden nicht geladen -- kein Netzwerkzugriff --,
 *    daher ist echte Pixelfläche diesem Modul ohnehin nicht zugänglich).
 *  - Behandelt jedes `<img>`-Tag gleich, unabhängig von `width`/`height`
 *    (ein winziges Tracking-Pixel zählt hier gleich viel wie ein
 *    bildschirmfüllendes Werbebanner).
 *
 * Gibt `null` zurück, wenn `rawText` kein erkennbares HTML-Markup enthält
 * (reine Text-Mail) -- die Kennzahl ist dann konzeptionell nicht anwendbar
 * ("nicht messbar"), nicht "0 Bilder gemessen". Enthält der Text HTML,
 * aber keine `<img>`-Tags, ist das Ergebnis ein echtes gemessenes `0`
 * (Design-Entscheidung, siehe README.md).
 */
export function computeImageToTextRatio(rawText: string): number | null {
  if (!HTML_TAG_REGEX.test(rawText)) return null;

  const imageCount = (rawText.match(IMG_TAG_REGEX) ?? []).length;
  const visibleText = stripHtml(rawText);
  const textWordCount = visibleText.length === 0 ? 0 : visibleText.split(" ").filter(Boolean).length;

  if (imageCount === 0 && textWordCount === 0) return 0;

  return imageCount / (imageCount + textWordCount);
}
