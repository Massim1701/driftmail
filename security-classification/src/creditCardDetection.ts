// Kreditkarten-Kandidaten im Text erlauben Gruppierung in 4er-Blöcken mit
// Leerzeichen oder Bindestrich (so werden Kartennummern praktisch immer
// geschrieben, z.B. "4111 1111 1111 1111" oder "4111-1111-1111-1111"),
// analog zu IBAN_CANDIDATE_REGEX in ibanDetection.ts. 13-19 Ziffern deckt
// den in ISO/IEC 7812 spezifizierten Längenbereich ab (Visa/Mastercard
// meist 16, Amex 15, manche Karten bis 19).
const CARD_CANDIDATE_REGEX = /\b(?:\d[ -]?){12,18}\d\b/g;

/**
 * Luhn-Algorithmus (ISO/IEC 7812), dasselbe Prinzip wie die
 * ISO-13616-Mod-97-Prüfsumme bei IBANs in ibanDetection.ts: von rechts nach
 * links jede zweite Ziffer verdoppeln, bei Übertrag (>9) die Quersumme
 * ziehen (entspricht -9), alle Ziffern summieren, gültig wenn Summe mod 10
 * = 0.
 */
function isValidLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/** Findet alle Luhn-gültigen Kreditkarten-Ziffernfolgen im Text, dedupliziert. */
export function extractCreditCardNumbers(rawText: string): string[] {
  const matches = rawText.match(CARD_CANDIDATE_REGEX) ?? [];
  const valid = new Set<string>();
  for (const m of matches) {
    const compact = m.replace(/[ -]/g, "");
    if (isValidLuhn(compact)) valid.add(compact);
  }
  return Array.from(valid);
}

/**
 * Erkennt, ob überhaupt eine Luhn-gültige Kartennummer im Text vorkommt.
 * Bekannte Grenze (analog zu `detectNewIban`): reine Muster-/Prüfsummen-
 * Erkennung, kein Abgleich gegen echte Issuer-BIN-Ranges -- eine zufällige,
 * aber Luhn-gültige 16-stellige Ziffernfolge (z.B. manche Bestellnummern,
 * Rechnungsnummern) kann theoretisch einen falsch-positiven Treffer
 * erzeugen. Das ist hier bewusst in Kauf genommen: `containsSensitiveData`
 * ist laut Contract NICHT blockierend, nur ein Warnhinweis -- ein
 * gelegentlicher falsch-positiver Warnhinweis ist deutlich unkritischer als
 * bei `blocked` (siehe draftPhishingCheck.ts).
 */
export function detectCreditCard(rawText: string): boolean {
  return extractCreditCardNumbers(rawText).length > 0;
}
