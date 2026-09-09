// Kleine, von mehreren Lookup-Adaptern geteilte Hilfsfunktionen.

/** Extrahiert die reine Domain aus einer E-Mail-Adresse ("a@b.de" -> "b.de").
 * Gibt null zurück, wenn kein "@" gefunden wird. */
export function domainFromAddress(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at === -1 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

/** Simpler, deterministischer String-Hash (kein Krypto-Hash nötig) --
 * Grundlage für die pseudo-zufälligen, aber stabilen Mock-Beispieldaten in
 * domainReputationMock.ts. Gleicher Input liefert immer denselben Output,
 * damit Tests deterministisch bleiben. */
export function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}
