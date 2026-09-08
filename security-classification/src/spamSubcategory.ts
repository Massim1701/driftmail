import type { SpamSubcategory } from "./types.js";

// ============================================================================
// PLATZHALTER-HEURISTIK -- hier gehört später echte KI/Inhaltsklassifikation
// hin (Text, ggf. Bilderkennung bei Anhängen -- siehe WEB_INBOX.md 08.09.).
//
// Reines Keyword-Zählen erkennt weder Umschreibungen noch Bilder/Anhänge und
// ist leicht durch Wortvariationen zu umgehen. Diese Funktion ist bewusst
// KONSERVATIV kalibriert: "adult"/"gambling" lösen im Aufrufer (Track A)
// sofortiges Löschen ohne Quarantäne/Undo aus, ein falsch-positiver Treffer
// wäre also besonders ärgerlich (legitime Mail verschwindet ersatzlos).
// Deshalb zwei Stufen pro Kategorie:
//   - STRONG: ein einziger Treffer reicht (eindeutige, im Alltag praktisch
//     nie harmlos vorkommende Phrasen, z.B. "casino bonus ohne einzahlung").
//   - WEAK: erst ab zwei Treffern wird die Kategorie vergeben (einzelne
//     Wörter wie "erotik" oder "casino" kommen auch in harmlosem Kontext vor,
//     z.B. eine Reise-Mail über ein Casino-Hotel).
// Produktionsversion: rawText (+ Anhänge) an den on-device- oder
// cloud-fallback-KI-Adapter übergeben (contracts/ai-adapter-interface.ts,
// AiSource) und dort inhaltlich klassifizieren lassen.
// ============================================================================

const ADULT_STRONG_KEYWORDS = [
  "xxx",
  "porno",
  "pornographic",
  "pornografische",
  "pornhub",
  "amateurporno",
  "sexcam",
  "live sexcam",
  "webcam sex",
  "erotikchat",
  "camgirls",
  "escort service",
  "sexkontakte in deiner nähe",
  "notgeile frauen",
  "milf sucht",
  "adult dating site",
  "onlyfans leak",
];

const ADULT_WEAK_KEYWORDS = [
  "sexkontakt",
  "erotik",
  "heiße singles",
  "18+",
  "nur für erwachsene",
  "dating für erwachsene",
  "nackte fotos",
];

const GAMBLING_STRONG_KEYWORDS = [
  "casino bonus ohne einzahlung",
  "freispiele ohne einzahlung",
  "jackpot geknackt",
  "online casino bonus",
  "sportwetten bonus",
  "willkommensbonus casino",
  "spielautomaten gratis spielen",
  "poker bonus code",
  "einzahlungsbonus casino",
  "no deposit bonus casino",
  "free spins no deposit",
];

const GAMBLING_WEAK_KEYWORDS = [
  "casino",
  "jackpot",
  "spielautomaten",
  "sportwetten",
  "freispiele",
  "roulette",
  "blackjack",
  "poker",
  "wette jetzt",
  "slots gratis",
];

// Marketing ist die "milde" Restkategorie -- eindeutige Werbe-/Rabattsprache,
// aber kein Phishing-/Betrugsrisiko und kein Erotik/Glücksspiel. Verhalten
// bleibt für diese Kategorie unverändert (normaler Spam-Ordner), sie dient
// hier nur der Vollständigkeit gegenüber "generic".
const MARKETING_KEYWORDS = [
  "rabatt",
  "gutschein",
  "gutscheincode",
  "prozent rabatt",
  "% off",
  "newsletter abbestellen",
  "unsubscribe",
  "sale endet",
  "black friday",
  "sonderangebot",
  "gratis versand",
  "jetzt bestellen",
  "limitiertes angebot",
];

function countHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}

/**
 * Ordnet Spam-Rohtext (Betreff+Body) einer Unterkategorie zu. Wird vom
 * Aufrufer (`index.ts`) NUR aufgerufen, wenn `classification === "spam"`
 * bereits feststeht -- diese Funktion trifft keine Aussage über phishing
 * vs. spam vs. safe, nur über die Art des Spams.
 *
 * "generic" ist der Default, wenn kein spezifisches Signal gefunden wird
 * (bewusst konservativ, siehe Kommentar oben).
 */
export function detectSpamSubcategory(rawText: string): SpamSubcategory {
  const text = rawText.toLowerCase();

  const adultStrongHits = countHits(text, ADULT_STRONG_KEYWORDS);
  const adultWeakHits = countHits(text, ADULT_WEAK_KEYWORDS);
  if (adultStrongHits >= 1 || adultWeakHits >= 2) {
    return "adult";
  }

  const gamblingStrongHits = countHits(text, GAMBLING_STRONG_KEYWORDS);
  const gamblingWeakHits = countHits(text, GAMBLING_WEAK_KEYWORDS);
  if (gamblingStrongHits >= 1 || gamblingWeakHits >= 2) {
    return "gambling";
  }

  if (countHits(text, MARKETING_KEYWORDS) >= 1) {
    return "marketing";
  }

  return "generic";
}
