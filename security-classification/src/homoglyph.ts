import { getHeader } from "./headers.js";

interface ScriptRange {
  name: string;
  ranges: Array<[number, number]>;
}

// Unicode-Skriptbereiche für die klassischen Homoglyph-Quellen. Nicht
// vollständig (z.B. Armenisch, Kyrillisch-Erweiterungen fehlen), deckt aber
// die in Phishing-Kampagnen mit Abstand häufigsten Verwechslungsskripte ab
// (Kyrillisch/Griechisch als Latin-Lookalikes).
const SCRIPT_RANGES: ScriptRange[] = [
  { name: "Latin", ranges: [[0x0041, 0x005a], [0x0061, 0x007a], [0x00c0, 0x024f]] },
  { name: "Cyrillic", ranges: [[0x0400, 0x04ff], [0x0500, 0x052f]] },
  { name: "Greek", ranges: [[0x0370, 0x03ff]] },
];

function scriptOf(codePoint: number): string | null {
  for (const s of SCRIPT_RANGES) {
    for (const [start, end] of s.ranges) {
      if (codePoint >= start && codePoint <= end) return s.name;
    }
  }
  return null;
}

// Explizite Konfusionstabelle: Zeichen aus anderen Skripten, die visuell
// (fast) identisch zu einem lateinischen Zeichen sind. Bewusst klein
// gehalten (die häufigsten Fälle aus echten Phishing-Domains) statt der
// vollständigen ~4000-Einträge-Unicode-Confusables-Tabelle -- eine
// Produktionsversion sollte die offizielle Unicode-Tabelle
// (unicode.org/Public/security/latest/confusables.txt) laden.
export const CONFUSABLES: Record<string, string> = {
  "а": "a", // Cyrillic Small Letter A U+0430
  "е": "e", // Cyrillic Small Letter Ie U+0435
  "о": "o", // Cyrillic Small Letter O U+043E
  "р": "p", // Cyrillic Small Letter Er U+0440
  "с": "c", // Cyrillic Small Letter Es U+0441
  "у": "y", // Cyrillic Small Letter U U+0443
  "х": "x", // Cyrillic Small Letter Ha U+0445
  "і": "i", // Cyrillic Small Letter Byelorussian-Ukrainian I U+0456
  "ѕ": "s", // Cyrillic Small Letter Dze U+0455
  "ј": "j", // Cyrillic Small Letter Je U+0458
  "ԁ": "d", // Cyrillic Small Letter Komi De U+0501
  "ɡ": "g", // Latin Small Letter Script G U+0261
  "ⅰ": "i", // Small Roman Numeral One U+2170
  "ⅼ": "l", // Small Roman Numeral Fifty U+217C
  "α": "a", // Greek Small Letter Alpha U+03B1
  "ο": "o", // Greek Small Letter Omicron U+03BF
  "ρ": "p", // Greek Small Letter Rho U+03C1
};

// Erkennt domainartige Tokens im Text (grob, unicode-fähig -- deckt auch
// nicht-punycode-kodierte IDN-Domains mit kyrillischen/griechischen Zeichen
// ab, wie sie in Phishing-Mails direkt als Klartext auftauchen).
export function extractDomains(text: string): string[] {
  const regex = /(?:[\p{L}0-9](?:[\p{L}0-9-]{0,61}[\p{L}0-9])?\.)+[\p{L}]{2,24}/gu;
  const matches = text.match(regex) ?? [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase())));
}

export function isMixedScriptLabel(label: string): boolean {
  const scriptsFound = new Set<string>();
  for (const ch of label) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const script = scriptOf(cp);
    if (script) scriptsFound.add(script);
  }
  return scriptsFound.size > 1;
}

export function containsConfusableChar(label: string): boolean {
  for (const ch of label) {
    if (CONFUSABLES[ch]) return true;
  }
  return false;
}

/**
 * Sucht nach Homoglyph-Angriffen in Absenderadresse, Headern und Body-Text:
 *
 * 1. Mixed-Script-Labels: ein Domain-Label, das Zeichen aus mehr als einem
 *    Schriftsystem mischt (z.B. lateinisches "a" neben kyrillischem "р"),
 *    ist praktisch immer ein Homograph-Versuch -- legitime Domains mischen
 *    das nicht.
 * 2. Explizite Konfusionszeichen: ein Label, das komplett aus Zeichen
 *    besteht, die in der CONFUSABLES-Tabelle stehen (z.B. eine komplett
 *    kyrillische Nachbildung von "apple"), wird von der Mixed-Script-Regel
 *    allein nicht erfasst, weil innerhalb des Labels nur ein Skript
 *    vorkommt -- deshalb der zusätzliche Check.
 *
 * Bekannte Grenze: kein Punycode-Decoding von "xn--"-Domains. Eine
 * Produktionsversion sollte IDN-Domains zuerst per punycode-Decoder in
 * Unicode auflösen, bevor sie hier geprüft werden.
 */
export function detectHomoglyphs(rawText: string, headers: Record<string, string>): boolean {
  const fromHeader = getHeader(headers, "From") ?? "";
  const replyToHeader = getHeader(headers, "Reply-To") ?? "";
  const domainsToCheck = new Set<string>([
    ...extractDomains(rawText),
    ...extractDomains(fromHeader),
    ...extractDomains(replyToHeader),
  ]);

  for (const domain of domainsToCheck) {
    const labels = domain.split(".");
    for (const label of labels) {
      if (isMixedScriptLabel(label)) return true;
      if (containsConfusableChar(label)) return true;
    }
  }
  return false;
}
