# security-classification — Track B

Eigenständiges, zustandsloses Modul, das `AiAdapter.analyzeMail` aus
[`contracts/ai-adapter-interface.ts`](../contracts/ai-adapter-interface.ts)
implementiert:

```ts
analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult>
```

Bekommt nur Rohtext + Mail-Headers rein, hat keinen Zugriff auf Backend,
Datenbank oder Netzwerk. Wird später von Track A in die Mail-Pipeline
eingehängt.

## Setup & Tests

```bash
cd security-classification
npm install
npm test          # vitest, 41 Tests
npm run typecheck # tsc --noEmit
npm run build     # -> dist/
```

## Struktur

| Datei | Zweck |
|---|---|
| `src/authHeaders.ts` | SPF/DKIM/DMARC aus `Authentication-Results` (+ `Received-SPF`-Fallback) |
| `src/homoglyph.ts` | Homoglyph-/IDN-Angriffe: Mixed-Script-Labels + explizite Unicode-Konfusionstabelle |
| `src/linkMismatch.ts` | Anzeigetext-vs-href-Domain-Vergleich (HTML-`<a>` und Markdown-Links) |
| `src/urgencyLanguage.ts` | Keyword-Heuristik für Dringlichkeitssprache (DE/EN) |
| `src/ibanDetection.ts` | IBAN-Erkennung per Regex + ISO-13616-Mod-97-Prüfsumme |
| `src/classification.ts` | Kombiniert alle Signale zu `classification` + `confidenceScore` (regelbasiert) |
| `src/index.ts` | `analyzeMail()` — verdrahtet alles zu einem `SecurityResult` |

Jede Einzelfunktion ist auch separat exportiert und getestet (`tests/*.test.ts`),
nicht nur über `analyzeMail()`.

## Was ist echte Logik, was ist Platzhalter

**Echte, deterministische Logik (kein ML nötig, funktioniert wie eingebaut):**

- SPF/DKIM/DMARC-Parsing aus `Authentication-Results` (RFC 8601)
- Homoglyph-Erkennung über Unicode-Skripterkennung (Mixed-Script-Labels)
  plus eine kleine, echte Konfusionstabelle (kyrillische/griechische
  Latin-Lookalikes)
- Link-Mismatch (Anzeigetext-Domain vs. tatsächliches href-Ziel)
- IBAN-Erkennung inkl. echter Mod-97-Prüfsummenvalidierung

**Klar markierte Platzhalter, die später echte KI/ML brauchen** (siehe
`PLATZHALTER`-Kommentare im Code):

- `urgencyLanguageScore` (`src/urgencyLanguage.ts`): reines Keyword-Zählen.
  Erkennt keine Umschreibungen, keinen Tonfall, keine Drohszenarien
  außerhalb der festen Wortliste. Sollte durch den on-device/cloud-fallback
  KI-Adapter (`AiSource` im Contract) ersetzt werden, der echtes
  Sprachverständnis nutzt.
- `classification` + `confidenceScore` (`src/classification.ts`):
  handverdrahtete Gewichtungsregeln, kein gelerntes Modell, keine
  Kalibrierung gegen echte Beispiele. Sollte durch einen trainierten/
  promptbasierten Klassifikator ersetzt werden, der alle Rohsignale +
  Volltext bekommt statt fester Schwellwerte.

## Bekannte Lücken / bewusste Annahmen

- **`senderDomainAgeDays` / `domainReputationScore`**: bleiben immer `null`.
  Beides braucht einen externen Dienst (WHOIS-Abfrage bzw.
  Reputationsdatenbank) und damit Netzwerkzugriff — außerhalb des Scopes
  "reiner Text+Header rein, Ergebnis raus". Ein Aufrufer (Track A) müsste
  diese Felder nach einem eigenen Lookup nachträglich befüllen, oder das
  Interface müsste einen optionalen Lookup-Adapter injizieren können.
- **`containsNewIban`**: Der Name impliziert einen Abgleich gegen zuvor vom
  selben Absender gesehene IBANs. Dieses Modul ist zustandslos und hat keine
  Historie — es kann nur erkennen, ob überhaupt eine gültige IBAN in der
  Mail vorkommt (`detectNewIban` in `src/ibanDetection.ts`, mit Kommentar an
  Ort und Stelle). Echte Neuheit muss der Aufrufer gegen gespeicherte IBANs
  (z.B. aus `contracts`-Tabelle oder einer Absender-Historie) prüfen. Siehe
  auch SYNC.md "Offene Fragen".
- **Punycode/IDN nicht dekodiert**: `xn--`-kodierte Domains werden nicht in
  Unicode aufgelöst, bevor sie auf Homoglyphen geprüft werden. Roh im Text
  vorkommende Unicode-Domains (der häufigere Phishing-Fall, weil Mailclients
  IDN direkt im Klartext anzeigen) werden erkannt.
- **Confusables-Tabelle ist unvollständig**: enthält die gängigsten
  kyrillischen/griechischen Latin-Lookalikes, nicht die vollständige
  Unicode-Confusables-Liste (~4000 Einträge,
  unicode.org/Public/security/latest/confusables.txt). Für Produktion
  empfehlenswert, diese Liste zu laden statt der Handauswahl hier.
- **Link-Mismatch nur bei HTML-`<a>`- oder Markdown-Links**: eine Mail als
  reiner Fließtext mit nackter URL ohne separaten Anzeigetext liefert kein
  Mismatch-Signal (es gibt nichts zum Vergleichen).
- **Mehrere `Authentication-Results`-Header** (z.B. bei mehreren Hops)
  werden nicht priorisiert — es wird einfach der per `getHeader()`
  gefundene erste Treffer geparst. Für Produktion: Header nach
  vertrauenswürdigstem/letztem Hop auswählen.

## Contract-Sync

`src/types.ts` enthält eine bewusst eigenständige Kopie von `SecurityResult`
aus `contracts/ai-adapter-interface.ts`, damit dieses Paket unabhängig
verschiebbar/installierbar bleibt. Bei jeder Änderung an `SecurityResult`
im Contract muss `src/types.ts` manuell nachgezogen werden.
