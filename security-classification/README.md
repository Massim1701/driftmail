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
npm test          # vitest, 57 Tests
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
| `src/spamSubcategory.ts` | Ordnet `classification === "spam"` einer Unterkategorie zu (`adult`/`gambling`/`generic`/`marketing`), Keyword-Heuristik |
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
- `spamSubcategory` (`src/spamSubcategory.ts`): reines Keyword-Zählen auf
  Betreff+Body (keine Anhang-/Bilderkennung). Bewusst konservativ
  kalibriert (siehe Design-Entscheidung unten), weil `adult`/`gambling` im
  Aufrufer (Track A) sofortiges Löschen ohne Quarantäne/Undo auslösen.
  Sollte durch echte Inhaltsklassifikation (Text + ggf. Bildanalyse bei
  Anhängen) über den KI-Adapter ersetzt werden.

## Design-Entscheidungen

- **`spamSubcategory` -- zweistufige Keyword-Schwelle statt einfachem
  Treffer-Zähler (08.09.):** `adult`/`gambling` lösen im Aufrufer sofortiges,
  endgültiges Löschen aus (kein Quarantäne-Pfad, kein Undo -- siehe
  WEB_INBOX.md 08.09.). Ein falsch-positiver Treffer wäre also deutlich
  teurer als bei den übrigen (nur informativen) Signalen dieses Moduls.
  Deshalb: "starke" Phrasen (eindeutig, praktisch nie harmlos, z.B. "casino
  bonus ohne einzahlung") lösen mit einem einzigen Treffer aus, "schwache"
  Einzelwörter (z.B. "casino", "erotik" -- können auch in harmlosem Kontext
  vorkommen, z.B. eine Reise-Mail über ein Hotel mit Casino) erst ab zwei
  Treffern. Bei Gleichstand zwischen mehreren Kategorien gewinnt die
  Prüfreihenfolge adult > gambling > marketing > generic (adult zuerst
  geprüft).
- **`marketing` vs. `generic` (08.09.):** Der bestehende `classify()`-Layer
  unterschied das bisher nicht (dort geht es nur um phishing/spam/safe/
  unclear). Für diesen Durchstich: `marketing` = eindeutige Rabatt-/
  Werbesprache (z.B. "Gutscheincode", "Newsletter abbestellen"), `generic`
  = Default für alles andere ohne spezifisches Signal. Verhalten für beide
  bleibt laut Contract unverändert (normaler Spam-Ordner) -- die
  Unterscheidung ist hier nur der Vollständigkeit wegen vorhanden, nicht
  weil ein Aufrufer sie aktuell unterschiedlich behandelt.
- **`spamSubcategory` wird NICHT für `classify()`s Entscheidung selbst
  verwendet:** Ob eine Mail überhaupt als "spam" (statt phishing/safe/
  unclear) gilt, entscheidet weiterhin ausschließlich `classification.ts`
  (Auth/Homoglyph/Link-Mismatch/Urgency/IBAN). `detectSpamSubcategory()`
  wird von `index.ts` erst danach aufgerufen, nur wenn `classification ===
  "spam"` bereits feststeht. Das hält die harte Contract-Regel
  ("spamSubcategory bei phishing immer null") strukturell ein, statt sie
  nur per if-Abfrage zu erzwingen.

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
- **`spamSubcategory` prüft nur Betreff+Body-Text, keine Anhänge/Bilder**:
  ein rein bildbasierter Erotik-/Glücksspiel-Spam (z.B. nur ein Bild, kaum
  Text) wird hier nicht erkannt und fällt auf `generic` zurück. Laut
  WEB_INBOX.md 08.09. ist Bilderkennung bei Anhängen für später vorgesehen,
  nicht Teil dieses Durchstichs.
- **`spamSubcategory`-Keyword-Listen sind nicht erschöpfend** und leicht
  durch Schreibvarianten/Leetspeak/andere Sprachen zu umgehen (nur DE/EN,
  keine Emoji-Ersatzzeichen o.ä.). Konservativ genug, um wenig
  falsch-positiv zu sein, aber sicher nicht vollständig — echte
  Inhaltsklassifikation ersetzt das später (siehe oben).

## Contract-Sync

`src/types.ts` enthält eine bewusst eigenständige Kopie von `SecurityResult`
aus `contracts/ai-adapter-interface.ts`, damit dieses Paket unabhängig
verschiebbar/installierbar bleibt. Bei jeder Änderung an `SecurityResult`
im Contract muss `src/types.ts` manuell nachgezogen werden. Aktueller Stand
inkl. `spamSubcategory` (08.09., siehe WEB_INBOX.md "Neue
Spam-Unterkategorie fuer aggressives Auto-Loeschen").

## Übergabe an Track A (spamSubcategory / Auto-Löschen)

Dieses Modul liefert nur die Erkennung (`SecurityResult.spamSubcategory`).
Die Handlungslogik ist explizit **nicht** Teil dieses Moduls und muss von
Track A in der Message-Pipeline ergänzt werden (siehe WEB_INBOX.md 08.09.):

- `classification === "spam"` UND `spamSubcategory` in `("adult",
  "gambling")` → sofort löschen, **keine** Quarantäne, **kein**
  30-Tage-Aufheben, **kein** Undo.
- `spamSubcategory` in `("generic", "marketing")` → Verhalten unverändert
  (normaler Spam-Ordner, normale Aufbewahrung).
- `classification === "phishing"` → von dieser Regel komplett unberührt,
  Vorsicht/Quarantäne bleibt Pflicht (`spamSubcategory` ist hier ohnehin
  immer `null`, siehe oben).

Track B (dieses Modul) ist für den Erkennungs-Teil ab diesem Commit
fertig; der Auto-Delete-Pfad läuft als separate Arbeit in Track A.
