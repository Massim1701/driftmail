// MRZ (Machine Readable Zone) -- die zwei/drei Zeilen mit "<"-Füllzeichen
// unten auf jedem Ausweisdokument/Reisepass (ICAO Doc 9303), laender- und
// dokumentuebergreifend genormtes Format:
//   TD3 (Reisepass):    2 Zeilen à 44 Zeichen
//   TD2 (Personalausw.): 2 Zeilen à 36 Zeichen
//   TD1 (Personalausw.): 3 Zeilen à 30 Zeichen
// Siehe WEB_INBOX.md 15.09. "Sensible-Daten-Erkennung um Fotos von
// Ausweisen/Kreditkarten erweitern": "zuverlaessig per Regex auf OCR-Text
// erkennbar, kein ML-Training noetig".
//
// Bewusst KEINE Pruefziffern-Validierung (ICAO 9303 definiert je Feld eine
// gewichtete Mod-10-Pruefziffer, analog zu Luhn/IBAN-Mod-97) -- anders als
// bei creditCardDetection.ts/ibanDetection.ts, wo eine Pruefsumme real
// existiert UND zuverlaessig nachvollziehbar bleibt. Hier waere das
// Gegenteil: OCR-Text aus einem fotografierten Dokument hat unvermeidbar
// einzelne Fehllesungen (siehe Testfall unten, ein "O" wurde faelschlich
// eingefuegt) -- eine strikte Pruefziffern-Pruefung wuerde in der Praxis
// die meisten echten Treffer als ungueltig verwerfen (False Negatives genau
// dort, wo die Erkennung am wichtigsten waere). Stattdessen ein toleranter
// Formheuristik-Ansatz: Zeilenlaenge + Zeichensatz (nur A-Z/0-9/"<") +
// Mindestanteil an "<"-Fuellzeichen + mindestens zwei aufeinanderfolgende
// solche Zeilen. Bewusst dieselbe Abwaegung wie bei urgencyLanguage.ts/
// spamSubcategory.ts: ein gelegentlicher falsch-positiver Warnhinweis ist
// unkritisch, da containsSensitiveDocument laut Contract NICHT blockierend
// ist, nur ein Hinweis.

const MRZ_LINE_CHARSET = /^[A-Z0-9<]+$/;
const MIN_LINE_LENGTH = 26; // knapp unter TD1 (30), Toleranz fuer OCR-Ausfaelle am Rand
const MAX_LINE_LENGTH = 50; // ueber TD3 (44), Toleranz fuer OCR-Fehleinfuegungen (siehe Testfall in mrzDetection.test.ts)
const MIN_FILLER_RATIO = 0.2; // typische MRZ-Zeilen sind stark "<"-gepolstert

function isMrzLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < MIN_LINE_LENGTH || trimmed.length > MAX_LINE_LENGTH) return false;
  if (!MRZ_LINE_CHARSET.test(trimmed)) return false;

  const fillerCount = (trimmed.match(/</g) ?? []).length;
  return fillerCount / trimmed.length >= MIN_FILLER_RATIO;
}

/**
 * Erkennt eine MRZ im (per OCR gewonnenen) Text: mindestens zwei
 * aufeinanderfolgende Zeilen, die dem MRZ-Formmuster entsprechen (deckt
 * TD2/TD3 direkt ab, TD1 indirekt über die ersten zwei seiner drei Zeilen).
 */
export function detectMrz(rawText: string): boolean {
  const lines = rawText.split(/\r?\n/).map((l) => l.toUpperCase());
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];
    if (current !== undefined && next !== undefined && isMrzLikeLine(current) && isMrzLikeLine(next)) return true;
  }
  return false;
}
