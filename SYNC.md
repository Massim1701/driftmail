# SYNC.md — Austausch zwischen Web-Claude und Claude Code

Regel: Wer etwas ändert, trägt hier ein, was und warum — direkt commiten. Niemand muss auf eine Antwort warten, um weiterzuarbeiten; nur bei einem Eintrag unter "Blocker" sollte der jeweils andere reagieren, bevor der betroffene Track weitermacht.

Format pro Eintrag: [Datum] [Quelle: web/terminal] [Track] — Text

## Status je Track

| Track | Ordner | Status | Zuletzt geändert |
|---|---|---|---|
| 0 — Contracts | contracts/ | fertig | 2026-09-08 |
| A — Backend | backend/ | offen | — |
| B — Sicherheits-Klassifikation | security-classification/ | fertig | 2026-09-08 |
| C — iOS App | ios/ | offen | — |
| D — Vertrag & Reminder | contracts-logic/ | offen | — |
| E — Antwort & Signatur | mail-actions/ | offen | — |
| F — Web-Fallback-UI | web/ | offen | — |

Status-Werte: offen · in arbeit · fertig · blockiert

## Änderungsprotokoll

[2026-09-08] [web] [0] — Contracts angelegt: db-schema.sql, api-spec.yaml, ai-adapter-interface.ts, design-tokens.json. Alle Tracks können starten.

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.

[2026-09-08] [terminal] [0] — Push nach main scheitert mit 403 "Permission denied" (authentifiziert als Massim1701, aber ohne Schreibrecht). Kein Keychain-Problem: `git credential fill` liefert denselben fine-grained PAT wie `gh auth token`. `gh api repos/.../driftmail -q .permissions` zeigt zwar `push:true`, das spiegelt aber die Owner-Rolle des Accounts wider, nicht die eigene Berechtigungsliste des eingeschränkten Tokens — irreführend, nicht verlässlich zur Diagnose nutzen. Workaround-Versuch mit `git -c http.extraHeader="Authorization: Bearer $TOKEN" push` hat NICHT geholfen (anderer Fehler: "invalid credentials"). Tatsächliche Ursache: Token hat für `driftmail` (noch) keine "Contents: Read and write"-Berechtigung gesetzt/gespeichert. Fix liegt bei Massimo in den GitHub-Token-Settings, nicht im Code.

[2026-09-08] [terminal] [0] — Blocker erledigt: Massimo hat einen klassischen PAT mit vollem `repo`-Scope erzeugt, damit erfolgreich nach main gepusht (Commits `1903164`, `263af99`). Der fine-grained PAT bleibt weiter ungeklärt (nicht mehr nachverfolgt, da Workaround funktioniert) -- fuer zukuenftige Pushes wird ggf. wieder ein Token gebraucht, siehe Hinweis in der naechsten Session.

[2026-09-08] [terminal] [B] — Track B gestartet: Skeleton für security-classification/ (analyzeMail-Implementierung: SPF/DKIM/DMARC-Header-Parsing, Homoglyph-Erkennung, Link-Mismatch, Dringlichkeitssprache-Heuristik, IBAN-Erkennung) auf Branch track-b-security.

[2026-09-08] [terminal] [B] — Track B fertig (erster Durchstich): `security-classification/` implementiert `analyzeMail(rawText, headers): Promise<SecurityResult>` aus dem Contract vollständig, alle 11 Felder befüllt. Echte, deterministische Logik für SPF/DKIM/DMARC-Parsing (Authentication-Results-Header), Homoglyph-Erkennung (Mixed-Script + Unicode-Konfusionstabelle), Link-Mismatch (Anzeigetext- vs. href-Domain) und IBAN-Erkennung (inkl. ISO-13616-Mod-97-Prüfsumme). `urgencyLanguageScore` und `classification`/`confidenceScore` sind bewusst als regelbasierte Platzhalter markiert (Kommentar "PLATZHALTER" im Code) für spätere echte NLP/ML-Klassifikation über den on-device/cloud-fallback-KI-Adapter. 41 Tests (vitest), Typecheck und Build laufen grün (`npm install && npm test` in `security-classification/`). Details, bekannte Lücken und Annahmen in `security-classification/README.md`. Zwei offene Fragen unten eingetragen (domainAge/reputation-Lookup, "neue" IBAN braucht Absender-Historie). Kein Zugriff auf Backend nötig gehabt, nicht auf Track A gewartet.

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

(noch keine Änderungen seit Track 0)

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- ~~api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.~~ **Beantwortet (Web, 08.09.):** kein Kürzen, war Absicht/Versehen — YAML wurde nachgezogen, alle 11 Felder jetzt drin.
- ~~api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.~~ **Beantwortet (Web, 08.09.):** beide Felder in der YAML ergänzt.
- **[B] `senderDomainAgeDays` / `domainReputationScore` brauchen einen externen Dienst** (WHOIS-Abfrage bzw. Domain-Reputationsdatenbank) und damit Netzwerkzugriff. `security-classification/` bekommt laut Auftrag nur rawText+headers rein (kein Netzwerk), liefert beide Felder deshalb immer als `null`. Wer befüllt das — Track A nach dem Aufruf von `analyzeMail()`, oder braucht das Interface einen zusätzlichen (optionalen) Lookup-Schritt/Adapter? Nicht selbst entscheidbar, da plattform-/architekturübergreifend.
- **[B] `containsNewIban` — was heißt "neu"?** Der Feldname impliziert einen Abgleich gegen zuvor vom selben Absender gesehene IBANs. `security-classification/` ist zustandslos (kein DB-Zugriff) und kann nur erkennen, ob überhaupt eine gültige IBAN in der Mail vorkommt (`detectNewIban()` in `security-classification/src/ibanDetection.ts`, dort ausführlich kommentiert). Echte Neuheitsprüfung gegen die IBAN-Historie eines Absenders müsste Track A (Backend/DB) übernehmen. Bitte klären, wo dieser Abgleich passieren soll.

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)
