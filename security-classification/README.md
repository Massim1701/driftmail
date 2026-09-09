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
npm test          # vitest, 110 Tests
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
| `src/heloMismatch.ts` | HELO/EHLO-Hostname aus `Received` vs. Absenderdomain aus `From` — Näherung, kein echter Reverse-DNS-Check |
| `src/imageToTextRatio.ts` | Bild-zu-Text-Anteil aus `<img>`-Tags vs. sichtbarer Textmenge in HTML-Mails |
| `src/ipReputation.ts` | Liefert immer `"unknown"` — braucht externen Blocklist-Abgleich, den dieses Modul nicht machen kann |
| `src/creditCardDetection.ts` | Kreditkarten-Erkennung per Regex + Luhn-Prüfsumme (analog zu `ibanDetection.ts`) |
| `src/credentialRequestLanguage.ts` | Keyword-Heuristik für explizite Zugangs-/Zahlungsdaten-Anfragen ("Passwort bestätigen", "Konto verifizieren", ...) |
| `src/draftPhishingCheck.ts` | `checkDraftForPhishing()` — Phishing-Check für ausgehende Mail-Entwürfe (`POST /messages/draft/phishing-check`) |
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
- `imageToTextRatio`: echte Zählung von `<img>`-Tags gegen sichtbare
  Textmenge in HTML-Mails (siehe Abschnitt "Botnetz-Erkennungssignale"
  unten für die genaue Formel und ihre Grenzen)
- Kreditkarten-Erkennung inkl. echter Luhn-Prüfsummenvalidierung
  (`src/creditCardDetection.ts`, siehe Abschnitt "Ausgehender
  Phishing-Check" unten)

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
- `heloMismatch` (`src/heloMismatch.ts`): grobe String-Heuristik statt
  echtem Reverse-DNS-Abgleich (siehe Abschnitt
  "Botnetz-Erkennungssignale"). Kein Platzhalter im Sinne von "tut nichts"
  -- liefert ein echtes, aber schwächeres Signal als ein vollständiger
  DNS-basierter Check.

**Kann dieses Modul strukturell nicht selbst liefern (nicht "noch nicht
gebaut", sondern architektonisch außerhalb des Scopes):**

- `ipReputationFlag` (`src/ipReputation.ts`): immer `"unknown"`. Braucht
  einen externen Netzwerk-Lookup (Botnetz-Blocklist), den ein
  zustandsloses Text+Header-Modul per Definition nicht hat. Siehe
  Abschnitt "Botnetz-Erkennungssignale" und SYNC.md "Offene Fragen".
- `recipientReputation` in `checkDraftForPhishing()`
  (`src/draftPhishingCheck.ts`): immer `"unknown"`. Braucht einen Abgleich
  gegen `fraud_alerts`/Empfänger-Historie in der DB, den ein zustandsloses
  Modul (nur `bodyText` + `links` rein) nicht machen kann. Siehe Abschnitt
  "Ausgehender Phishing-Check" und SYNC.md "Offene Fragen".

## Botnetz-Erkennungssignale (`ipReputationFlag` / `heloMismatch` / `imageToTextRatio`)

Contract-Zusatz aus WEB_INBOX.md 08.09. ("Botnetz-Erkennungssignale") --
Botnetz-Spam hat KEINEN stabilen Absender (IP/Domain wechseln ständig,
Absender oft gefälscht/gekapert), Erkennung muss also auf
Infrastruktur-Verhalten zielen statt auf Absender-Blocklisten. Die drei
Felder haben sehr unterschiedliche ehrliche Grenzen:

- **`imageToTextRatio` -- echte, deterministische Berechnung** (kein
  Platzhalter): zählt `<img>`-Tags im Verhältnis zur sichtbaren Textmenge
  (Wortanzahl nach Tag-Entfernung), `imageCount / (imageCount +
  textWordCount)`. `null` wenn `rawText` kein erkennbares HTML enthält
  (Kennzahl konzeptionell nicht anwendbar), echtes `0` wenn HTML vorhanden
  ist, aber keine Bilder. Siehe `src/imageToTextRatio.ts` für die
  Design-Entscheidung und bekannte Grenzen (kein CSS-`background-image`,
  keine echte Bildflächen-/Pixelanalyse, jedes `<img>` zählt gleich viel
  egal wie klein).
- **`heloMismatch` -- teilweise ehrlich ableitbar, aber Näherung, kein
  echter Reverse-DNS-Check:** vergleicht den behaupteten HELO/EHLO-Hostnamen
  aus dem `Received`-Header mit der Absenderdomain aus `From` (grobe
  String-Heuristik: Subdomain-Beziehung = kein Mismatch, sonst Mismatch). Ein
  echter Check würde die tatsächliche Reverse-DNS-Auflösung (PTR-Record) der
  sendenden IP gegen den behaupteten HELO-Namen prüfen -- das braucht einen
  DNS-Lookup (Netzwerkzugriff), den dieses Modul nicht hat. Siehe
  `src/heloMismatch.ts` für Extraktionslogik und den dokumentierten,
  erwartbaren False-Positive-Fall bei Drittanbieter-Versanddiensten (Google
  Workspace, Mailchimp, SendGrid, ...).
- **`ipReputationFlag` -- kann dieses Modul NICHT ehrlich befüllen:**
  braucht einen Abgleich der sendenden IP gegen externe,
  botnetzspezifische Blocklisten (z.B. Spamhaus XBL/CBL). Das ist ein reiner
  Netzwerk-Lookup, für den es in einem zustandslosen Text+Header-Modul
  keinen ehrlichen Weg gibt. Liefert deshalb IMMER `"unknown"`, siehe
  `src/ipReputation.ts` und "Bekannte Lücken" unten (analog zu
  `senderDomainAgeDays`/`domainReputationScore`).

Laut WEB_INBOX.md 08.09. reicht "kein einzelnes Signal allein aus" --
`ipReputationFlag = 'known_botnet'` UND `heloMismatch` UND hoher
`imageToTextRatio` zusammen sind ein starkes Muster, aber die
Verknüpfung/Entscheidungslogik ist bewusst NICHT Teil dieses Moduls
(gehört in den Aufrufer/`classification.ts`-Layer, falls gewünscht -- hier
noch nicht verdrahtet).

## Ausgehender Phishing-Check (`checkDraftForPhishing`)

Contract-Zusatz aus WEB_INBOX.md 08.09. ("Ausgehender Phishing-Check im
Composer") und `contracts/api-spec.yaml` (`POST
/messages/draft/phishing-check`, Commit `b6b3eb2`). Prüft einen
Mail-**Entwurf** (`bodyText` + bereits vom Composer extrahierte `links:
Array<{displayText, actualUrl}>`) vor dem Versand -- schützt driftmail
selbst davor, als Phishing-Versandweg missbraucht zu werden (z.B. über ein
kompromittiertes Gerät/Konto). Implementiert in
`src/draftPhishingCheck.ts`, exportiert als `checkDraftForPhishing()`.

**Bewusst wiederverwendet statt dupliziert:** die Erkennungslogik für
eingehende Mails (`analyzeMail`) wurde dafür an den passenden Stellen
refaktoriert, statt eine zweite Kopie zu schreiben:

- `linkMismatch.ts`: `detectLinkMismatch(rawText)` (Mails) extrahiert jetzt
  selbst Links und ruft für jeden das neu exportierte `isLinkMismatch(link)`
  auf -- genau diese Funktion nutzt `checkDraftForPhishing` direkt für die
  vom Composer bereits strukturiert übergebenen Links.
- `homoglyph.ts`: `detectHomoglyphs(rawText, headers)` (Mails) ruft jetzt
  pro gefundener Domain das neu exportierte `isHomoglyphDomain(domain)` auf
  -- dieselbe Funktion prüft in `checkDraftForPhishing` die Ziel- und
  Anzeigetext-Domain jedes Entwurfs-Links.
- `urgencyLanguage.ts` (`scoreUrgencyLanguage`) und `ibanDetection.ts`
  (`extractIbans`) werden unverändert wiederverwendet.

**Neu für diesen Endpoint (nicht Teil von `analyzeMail`/`SecurityResult`):**

- `src/creditCardDetection.ts` -- echte Kreditkarten-Erkennung per Regex +
  Luhn-Prüfsumme (ISO/IEC 7812), exakt analog zu `ibanDetection.ts`s
  Mod-97-Prüfsumme.
- `src/credentialRequestLanguage.ts` -- PLATZHALTER-Keyword-Heuristik für
  explizite Zugangs-/Zahlungsdaten-Anfragen ("Passwort bestätigen", "Konto
  verifizieren", "Zahlungsdaten aktualisieren", ...). Wird NIE alleine für
  `blocked` verwendet, siehe unten.

**`blocked` -- bewusst konservative Schwelle (harter Block, siehe
`src/draftPhishingCheck.ts` für die ausführliche Begründung im Code):**
lieber ein false negative als ein false positive, weil `blocked` den
Versand komplett verhindert (kein "Warnen-und-trotzdem-erlauben" wie bei
den übrigen Feldern hier). Drei Wege zu `blocked = true`:

1. `isLinkMismatch` auf irgendeinen Link (Anzeigetext behauptet eine
   Domain, das Ziel ist eine andere).
2. `isHomoglyphDomain` auf eine Link-Domain (Ziel-URL ODER Anzeigetext).
3. `scoreUrgencyLanguage(bodyText) >= 0.5` **UND**
   `detectsCredentialOrPaymentRequest(bodyText)` -- absichtlich eine
   UND-Verknüpfung. Dringlichkeits-Sprache allein kommt auch in legitimen
   Mails vor ("bitte dringend bis Freitag antworten"), eine
   Zugangsdaten-Anfrage allein ebenfalls (z.B. eine interne
   IT-Support-Mail). Erst die Kombination ist der klassische Phishing-Move.
   Die Schwelle `0.5` übernimmt bewusst den Wert, den `classification.ts`
   auf der Empfangsseite bereits als Relevanz-Schwelle für
   `urgencyLanguageScore` nutzt (`> 0.5` dort), statt eine neue,
   unkalibrierte Zahl zu erfinden.

`containsSensitiveData` und `riskyLinks` sind laut Contract **nicht**
blockierend, nur Warnhinweise für den Nutzer -- eigene sensible Daten
mitzuteilen ist nicht per se falsch (z.B. eigene IBAN für eine Überweisung
nennen). Sie werden unabhängig vom `blocked`-Ergebnis befüllt.

`containsSensitiveData: "other"` ist bewusst **nicht** implementiert (z.B.
Sozialversicherungsnummer-Muster wären möglich gewesen): anders als bei
IBAN (Mod-97) oder Kreditkarte (Luhn) gibt es dafür kein einheitliches,
prüfsummenvalidierbares Format über Länder hinweg -- ein reiner
Regex-/Längen-Rateversuch ohne Prüfsumme wäre deutlich fehleranfälliger
als die beiden anderen Kategorien, deshalb weggelassen statt eines
unehrlichen Rateversuchs.

`recipientReputation` ist immer `"unknown"` -- siehe "Was ist echte Logik,
was ist Platzhalter" oben und "Übergabe an Track A" unten.

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
- **`imageToTextRatio`-Formel und `null`-vs-`0`-Unterscheidung (08.09.):**
  `null` bedeutet "nicht messbar" (kein HTML im Text -- reiner Text kann
  keinen Bildanteil haben), `0` bedeutet "gemessen: kein Bild vorhanden".
  Diese Unterscheidung ist bewusst, weil beide Fälle für einen Aufrufer
  unterschiedlich zu behandeln sind (fehlender Messwert vs. echter
  Negativbefund). Die Formel `imageCount / (imageCount + textWordCount)`
  (statt z.B. `imageCount / textWordCount`, das bei textWordCount=0
  undefiniert wäre) bleibt garantiert im Bereich 0.0-1.0, wie im Contract
  gefordert.
- **`heloMismatch` als grobe String-Heuristik statt "kein Signal" (08.09.):**
  Statt das Feld mangels echtem Reverse-DNS-Zugriff komplett wegzulassen
  (wie bei `ipReputationFlag`), liefert es eine schwächere, aber ehrliche
  Näherung -- der Auftrag verlangte explizit, den vorhandenen
  `Received`-Header-Inhalt zu nutzen, statt pauschal aufzugeben. Klar als
  Näherung dokumentiert (nicht als echter Reverse-DNS-Check), inklusive des
  erwartbaren False-Positive-Falls bei Drittanbieter-Relays -- ein Aufrufer
  darf dieses Signal deshalb nicht alleinstehend für automatische
  Lösch-/Quarantäne-Entscheidungen verwenden.
- **`ipReputationFlag` liefert IMMER `"unknown"`, nie geraten (08.09.):**
  Anders als bei `heloMismatch` gibt es hier keine sinnvolle
  Text/Header-Näherung -- Reputation einer IP lässt sich nicht aus der IP
  selbst ableiten, nur aus einem externen Abgleich. Ein geratener Wert
  (z.B. "clean" als Default) wäre vorgetäuschte Sicherheit und schlimmer
  als ehrliches `"unknown"`.
- **`blocked`-Schwelle im ausgehenden Phishing-Check bewusst konservativ,
  UND statt ODER bei Dringlichkeit+Zugangsdatenanfrage (08.09.):** Anders
  als `classify()` auf der Empfangsseite (dort gibt es keinen harten Block,
  nur eine Klassifikation, die Track A/UI in Quarantäne/Warnhinweis
  übersetzt) verhindert `blocked = true` hier den Versand komplett. Ein
  falsch-positiver Block wäre ein Produktvertrauensbruch (Nutzer kann eine
  legitime Mail nicht senden); ein falsch-negativer Fall ist "nur" ein
  verpasster Fang. Deshalb nur die drei stärksten, praktisch
  eindeutigen Signale (siehe Abschnitt "Ausgehender Phishing-Check" oben),
  und Dringlichkeit + Zugangsdatenanfrage bewusst als UND statt ODER
  verknüpft, weil jedes der beiden Signale allein auch in legitimen Mails
  vorkommt.
- **`isLinkMismatch`/`isHomoglyphDomain` aus `linkMismatch.ts`/
  `homoglyph.ts` extrahiert statt eigene Kopie in
  `draftPhishingCheck.ts` (08.09.):** Der Auftrag verlangte explizit
  Wiederverwendung der bestehenden Logik statt Duplikation. Die
  Mail-Erkennung (`detectLinkMismatch`/`detectHomoglyphs`) wurde dafür
  minimal refaktoriert (Extraktion + Delegation an die neue Pro-Element-
  Funktion), ihr beobachtbares Verhalten/ihre Tests sind unverändert.
- **Kreditkarten-Regex/Luhn statt reinem Keyword-Scan (08.09.):** analog
  zur bestehenden Design-Entscheidung bei `ibanDetection.ts` (Mod-97 statt
  reinem Ziffern-Pattern) -- eine Prüfsumme reduziert falsch-positive
  Treffer auf zufällige 13-19-stellige Zahlenfolgen (z.B. lange
  Bestellnummern) erheblich, ist aber kein Ersatz für einen echten
  Issuer-BIN-Abgleich. Da `containsSensitiveData` nicht blockierend ist
  (siehe oben), ist das verbleibende Restrisiko falsch-positiver
  Warnhinweise hier unkritisch.
- **`detectsCredentialOrPaymentRequest` reine Substring-Keyword-Liste,
  Wortreihenfolge relevant (08.09.):** z.B. "Passwort bestätigen" matcht,
  "bestätigen Sie Ihr Passwort" (umgestellte Wortreihenfolge) NICHT. Das
  ist eine bekannte Schwäche reiner Substring-Heuristiken (siehe auch
  `spamSubcategory.ts`/`urgencyLanguage.ts` oben) und bewusst in Kauf
  genommen, weil diese Funktion NIE allein `blocked` auslöst -- immer nur
  in Kombination mit hoher Dringlichkeits-Sprache. Ein echter NLP-Ersatz
  gehört wie bei den anderen Platzhaltern in den KI-Adapter.
- **`spamSubcategory` (`adult`/`gambling`) ist seit 09.09. ein
  EIGENSTÄNDIGER Klassifikations-Trigger, nicht mehr nur eine nachgelagerte
  Verfeinerung (SYNC.md, Web-Antwort auf einen Fund aus der Track-A+B-
  Integration):**

  **Alt (bis 08.09.):** Ob eine Mail überhaupt als "spam" (statt
  phishing/safe/unclear) galt, entschied ausschließlich `classification.ts`
  (Auth/Homoglyph/Link-Mismatch/Urgency/IBAN). `detectSpamSubcategory()`
  wurde von `index.ts` erst DANACH aufgerufen, nur wenn `classification ===
  "spam"` durch diese Signale bereits feststand -- reine Verfeinerung
  ("welche Art Spam ist es"), keine eigene Entscheidung ("ist es
  überhaupt Spam").

  **Problem:** Der ursprüngliche Anlass für die ganze `spamSubcategory`-Regel
  war explizit "Sex-/Glücksspiel-Mails erkennen und sofort löschen"
  (WEB_INBOX.md 08.09.). Genau diese Mails sind in der Praxis aber meist
  technisch "sauber" -- kein SPF-Fail, kein Link-Mismatch, keine
  Homoglyphen, keine Dringlichkeits-Sprache. Mit der alten Reihenfolge
  erreichten sie `classification.ts`'s "spam"-Schwelle (phishingScore
  0.25-0.5) oft gar nicht und blieben "unclear"/"safe" -- die Regel griff
  im eigentlichen Hauptfall nicht, für den sie gebaut wurde. Das kam erst
  während der Track-A+B-Integration ans Licht, als ein Backend-Fixture mit
  reinem Glücksspiel-Text ohne technisches Signal fälschlich nicht als Spam
  erkannt wurde.

  **Neu (ab 09.09.):** `index.ts` ruft `detectSpamSubcategory()` jetzt
  IMMER auf, unabhängig vom `classification.ts`-Ergebnis. Liefert es
  `"adult"` oder `"gambling"`, wird `classification` auf `"spam"` gehoben,
  AUCH wenn `classification.ts` sonst `"safe"`/`"unclear"` ergäbe -- außer
  `classification.ts` hat bereits `"phishing"` festgestellt (stärkeres,
  spezifischeres Signal geht vor, ein zufälliger Content-Treffer soll ein
  echtes Phishing-Ergebnis nicht herabstufen). `generic`/`marketing` bleiben
  bewusst weiterhin rein nachgelagert (kein eigener Trigger) -- nur
  `adult`/`gambling` ist die zeitkritische Auto-Delete-Kategorie im
  Aufrufer (Track A), `generic`/`marketing` landet ohnehin nur im normalen
  Spam-Ordner ohne Eile.

  **Konfidenz:** Ein rein content-getriggertes `"spam"` (ohne jedes
  phishing-artige Signal) bekommt einen fixen Platzhalterwert
  `CONTENT_TRIGGERED_SPAM_CONFIDENCE = 0.75` statt der
  `classify()`-Formel (die für phishingScore=0 ohnehin nur "unclear"/0.4
  oder "safe"/0.5 liefern würde, beides für ein Feld irreführend, das jetzt
  effektiv "spam" mit Auto-Delete-Konsequenz bedeutet). 0.75 gewählt: klar
  über der 0.5-Grenze, aber unter dem, was ein echtes technisches
  Phishing-Signal typischerweise erreicht (>= 0.85) — ein reiner
  Content-Treffer ohne technisches Signal ist etwas weniger sicher.

  Tests: `tests/index.test.ts`, describe-Block "content-triggered spam"
  (klarer adult/gambling-Treffer ohne jedes Signal -> spam; reiner
  marketing/generic-Text ohne Signal -> weiterhin unclear/nachgelagert;
  bereits erkanntes phishing wird durch Content-Keywords nicht
  herabgestuft).

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
- **`ipReputationFlag`**: bleibt immer `"unknown"`. Braucht einen Abgleich
  der sendenden IP gegen externe Botnetz-Blocklisten (z.B. Spamhaus
  XBL/CBL) und damit Netzwerkzugriff — außerhalb des Scopes, exakt wie bei
  `senderDomainAgeDays`/`domainReputationScore` oben. Ein Aufrufer
  (vermutlich Track A, da das Backend Netzwerkzugriff hat) müsste dieses
  Feld nach dem `analyzeMail()`-Aufruf selbst per eigenem Lookup befüllen.
  Siehe auch SYNC.md "Offene Fragen".
- **`heloMismatch` ist eine Näherung, kein echter Reverse-DNS-Check**: es
  vergleicht nur den behaupteten HELO/EHLO-Hostnamen aus dem
  `Received`-Header mit der Absenderdomain aus `From` (String-Heuristik).
  Ein echter Check bräuchte einen DNS-Lookup (PTR-Record der sendenden IP),
  den dieses Modul nicht hat. Bekannter, erwartbarer False-Positive-Fall:
  legitime Mails über Drittanbieter-Versanddienste (Google Workspace,
  Mailchimp, SendGrid, ...) haben typischerweise einen HELO-Hostnamen auf
  einer anderen Domain als der Absender — das ist normal, kein
  Botnetz-Indiz. Zusätzlich: der Contract übergibt Header als
  `Record<string, string>` (ein Wert pro Schlüssel), bei mehreren Hops
  (mehrere `Received`-Header) kann also ohnehin nur der eine Wert
  ausgewertet werden, den der Aufrufer unter diesem Schlüssel bereitstellt
  — keine Priorisierung des relevantesten Hops (analog zur bestehenden
  `Authentication-Results`-Einschränkung in `authHeaders.ts`).
- **`imageToTextRatio` zählt nur `<img>`-Tags**, keine per CSS
  `background-image` eingebundenen Bilder, und misst Textmenge in Wörtern
  statt tatsächlicher Bildfläche (Bilder werden nicht geladen — kein
  Netzwerkzugriff). Jedes `<img>`-Tag zählt gleich viel, unabhängig von
  Größe (ein 1x1-Tracking-Pixel zählt wie ein bildschirmfüllendes Banner).
- **`recipientReputation`** (`checkDraftForPhishing`): bleibt immer
  `"unknown"`. Braucht einen Abgleich der Empfänger-Adresse gegen
  `fraud_alerts`/Empfänger-Historie in der DB — außerhalb des Scopes
  "bodyText+links rein, Ergebnis raus", exakt dieselbe Kategorie
  Einschränkung wie bei `senderDomainAgeDays`/`domainReputationScore`/
  `ipReputationFlag` oben. Siehe "Übergabe an Track A" unten.
- **Kreditkarten-Erkennung ohne Issuer-BIN-Abgleich**: eine zufällige,
  aber Luhn-gültige 13-19-stellige Ziffernfolge (z.B. manche
  Bestellnummern) kann theoretisch fälschlich als Kreditkarte erkannt
  werden. Unkritisch, da `containsSensitiveData` nur ein nicht-blockierender
  Warnhinweis ist (siehe "Ausgehender Phishing-Check" oben).
- **`detectsCredentialOrPaymentRequest` ist wortreihenfolge-sensitiv**
  (reine Substring-Suche, keine Umschreibungen/Wortumstellungen erkannt).
  Siehe Design-Entscheidung oben, warum das hier bewusst in Kauf genommen
  wird (nie alleinige Blockierungs-Grundlage).
- **`containsSensitiveData: "other"` nicht implementiert** (z.B.
  Sozialversicherungsnummer-Muster) — kein länderübergreifend
  einheitliches, prüfsummenvalidierbares Format verfügbar, siehe
  "Ausgehender Phishing-Check" oben.

## Contract-Sync

`src/types.ts` enthält eine bewusst eigenständige Kopie von `SecurityResult`
aus `contracts/ai-adapter-interface.ts`, damit dieses Paket unabhängig
verschiebbar/installierbar bleibt. Bei jeder Änderung an `SecurityResult`
im Contract muss `src/types.ts` manuell nachgezogen werden. Aktueller Stand
inkl. `spamSubcategory` (08.09., siehe WEB_INBOX.md "Neue
Spam-Unterkategorie fuer aggressives Auto-Loeschen") sowie
`ipReputationFlag`/`heloMismatch`/`imageToTextRatio` (08.09., siehe
WEB_INBOX.md "Botnetz-Erkennungssignale").

Der ausgehende Phishing-Check (`src/draftPhishingCheck.ts`,
`DraftPhishingCheckResult`) ist NICHT Teil von `SecurityResult` -- eigener
Response-Typ, der `POST /messages/draft/phishing-check` aus
`contracts/api-spec.yaml` (Commit `b6b3eb2`) spiegelt. Gleiche
Sync-Pflicht: bei Änderungen an diesem Endpoint-Schema muss
`src/draftPhishingCheck.ts` manuell nachgezogen werden.

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

**Update 09.09.:** `adult`/`gambling` erreichen `classification === "spam"`
jetzt auch OHNE begleitendes technisches Signal (Auth-Fail/Homoglyph/
Link-Mismatch/Dringlichkeit) -- siehe "Design-Entscheidungen" oben,
"eigenständiger Klassifikations-Trigger". Für Track A ändert sich an der
Handlungslogik selbst nichts (weiterhin einfach `classification`/
`spamSubcategory` aus dem `SecurityResult` auslesen), nur mehr echte
Glücksspiel-/Erotik-Mails erreichen diesen Pfad jetzt zuverlässig.

## Übergabe an Track A (`ipReputationFlag`)

Dieses Modul liefert `ipReputationFlag` immer als `"unknown"` (siehe
"Botnetz-Erkennungssignale" oben) -- ein echter Blocklist-Abgleich braucht
Netzwerkzugriff, den dieses Modul nicht hat. Wer den externen Lookup nach
dem `analyzeMail()`-Aufruf durchführt und das Feld nachträglich befüllt
(vermutlich Track A, da das Backend Netzwerkzugriff hat), ist als offene
Frage in SYNC.md "Offene Fragen" eingetragen -- nicht selbst entscheidbar,
da plattform-/architekturübergreifend.

## Übergabe an Track A (`recipientReputation`, ausgehender Phishing-Check)

`checkDraftForPhishing()` liefert `recipientReputation` immer als
`"unknown"` (siehe "Ausgehender Phishing-Check" oben) -- ein echter
Abgleich der Empfänger-Adresse gegen `fraud_alerts`/Empfänger-Historie
braucht DB-Zugriff, den dieses zustandslose Modul (nur `bodyText` + `links`
rein) nicht hat. Genau dieselbe Kategorie Einschränkung wie bei
`ipReputationFlag`/`senderDomainAgeDays`/`domainReputationScore` oben.

Wer den Lookup nach dem `checkDraftForPhishing()`-Aufruf durchführt und das
Feld nachträglich befüllt (vermutlich Track A, da das Backend DB-Zugriff
hat), ist als neue offene Frage in SYNC.md "Offene Fragen" eingetragen --
nicht selbst entscheidbar, da plattform-/architekturübergreifend. Laut
WEB_INBOX.md 08.09. soll bei der Kombination "sensible Daten im Text" +
"Empfänger mit schlechter Reputation" der UI-Warnhinweis deutlich
schärfer formuliert werden (rote statt gelbe Sprechblase) -- das ist
UI-Logik im aufrufenden Track (C/F), nicht Teil dieses Moduls.

`blocked`/`riskyLinks`/`containsSensitiveData` sind unabhängig von
`recipientReputation` bereits vollständig nutzbar -- nur die
Reputationsabfrage selbst fehlt.
