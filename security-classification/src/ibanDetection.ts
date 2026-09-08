// IBAN-Kandidaten im Text erlauben Gruppierung in Blöcken mit Leerzeichen
// (so werden IBANs in E-Mails praktisch immer geschrieben, z.B.
// "DE89 3704 0044 0532 0130 00" -- der letzte Block ist oft kürzer als 4
// Zeichen, deshalb {1,4} statt fix {4}).
const IBAN_CANDIDATE_REGEX = /\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{1,4}){2,7}\b/g;

/**
 * ISO-13616 Mod-97-Prüfsummen-Check: Land+Prüfziffern ans Ende verschieben,
 * Buchstaben in Zahlen umwandeln (A=10 ... Z=35), Ergebnis mod 97 muss 1
 * sein. BigInt statt Number, weil die Zahl für lange IBANs zu groß für
 * sichere Number-Arithmetik wird.
 */
function isValidIban(candidate: string): boolean {
  const iban = candidate.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));

  try {
    return BigInt(numeric) % 97n === 1n;
  } catch {
    return false;
  }
}

/** Findet alle gültigen (prüfsummenkorrekten) IBANs im Text, dedupliziert. */
export function extractIbans(rawText: string): string[] {
  const upper = rawText.toUpperCase();
  const matches = upper.match(IBAN_CANDIDATE_REGEX) ?? [];
  const valid = new Set<string>();
  for (const m of matches) {
    const compact = m.replace(/\s+/g, "");
    if (isValidIban(compact)) valid.add(compact);
  }
  return Array.from(valid);
}

/**
 * Achtung -- Namensgebung im Contract ist "containsNewIban" ("neue" IBAN),
 * das impliziert einen Abgleich gegen zuvor von diesem Absender gesehene
 * IBANs. Dieses Modul ist zustandslos (nur rawText + headers als Input,
 * kein DB-/Backend-Zugriff laut Auftrag) und kann "neu" daher NICHT
 * feststellen -- es kann nur erkennen, ob überhaupt eine gültige IBAN in
 * der Mail steht. Das ist als Proxy-Signal zu verstehen: Track A muss diese
 * IBAN(s) gegen die Historie des Absenders (contracts-Tabelle o.ä.)
 * abgleichen, um "neu" im eigentlichen Sinn zu bestimmen. Siehe
 * SYNC.md "Offene Fragen" und README.md.
 */
export function detectNewIban(rawText: string): boolean {
  return extractIbans(rawText).length > 0;
}
