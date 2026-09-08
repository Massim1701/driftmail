# SYNC.md — Austausch zwischen Web-Claude und Claude Code

Regel: Wer etwas ändert, trägt hier ein, was und warum — direkt commiten. Niemand muss auf eine Antwort warten, um weiterzuarbeiten; nur bei einem Eintrag unter "Blocker" sollte der jeweils andere reagieren, bevor der betroffene Track weitermacht.

Format pro Eintrag: [Datum] [Quelle: web/terminal] [Track] — Text

## Status je Track

| Track | Ordner | Status | Zuletzt geändert |
|---|---|---|---|
| 0 — Contracts | contracts/ | fertig | 2026-09-08 |
| A — Backend | backend/ | offen | — |
| B — Sicherheits-Klassifikation | security-classification/ | offen | — |
| C — iOS App | ios/ | offen | — |
| D — Vertrag & Reminder | contracts-logic/ | fertig | 2026-09-08 |
| E — Antwort & Signatur | mail-actions/ | offen | — |
| F — Web-Fallback-UI | web/ | offen | — |

Status-Werte: offen · in arbeit · fertig · blockiert

## Änderungsprotokoll

[2026-09-08] [web] [0] — Contracts angelegt: db-schema.sql, api-spec.yaml, ai-adapter-interface.ts, design-tokens.json. Alle Tracks können starten.

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.

[2026-09-08] [terminal] [0] — Push nach main scheitert mit 403 "Permission denied" (authentifiziert als Massim1701, aber ohne Schreibrecht). Kein Keychain-Problem: `git credential fill` liefert denselben fine-grained PAT wie `gh auth token`. `gh api repos/.../driftmail -q .permissions` zeigt zwar `push:true`, das spiegelt aber die Owner-Rolle des Accounts wider, nicht die eigene Berechtigungsliste des eingeschränkten Tokens — irreführend, nicht verlässlich zur Diagnose nutzen. Workaround-Versuch mit `git -c http.extraHeader="Authorization: Bearer $TOKEN" push` hat NICHT geholfen (anderer Fehler: "invalid credentials"). Tatsächliche Ursache: Token hat für `driftmail` (noch) keine "Contents: Read and write"-Berechtigung gesetzt/gespeichert. Fix liegt bei Massimo in den GitHub-Token-Settings, nicht im Code.

[2026-09-08] [terminal] [0] — Blocker erledigt: Massimo hat einen klassischen PAT mit vollem `repo`-Scope erzeugt, damit erfolgreich nach main gepusht (Commits `1903164`, `263af99`). Der fine-grained PAT bleibt weiter ungeklärt (nicht mehr nachverfolgt, da Workaround funktioniert) -- fuer zukuenftige Pushes wird ggf. wieder ein Token gebraucht, siehe Hinweis in der naechsten Session.

[2026-09-08] [terminal] [D] — Branch `track-d-contracts-logic` angelegt und Status auf "in Arbeit" gesetzt.

[2026-09-08] [terminal] [D] — `extractContract(rawText)` implementiert: regelbasierte/heuristische Extraktion von Anbietername (Label-Muster, Rechtsform-Suffixe wie GmbH/AG/KG, Signaturzeile), Datumsformaten (DD.MM.YYYY, YYYY-MM-DD, "1. Januar 2026") und Kündigungsfrist (Tage/Wochen/Monate). Additive Konfidenz-Berechnung, gedeckelt auf 0.95 (1.0 bleibt echter KI-Extraktion vorbehalten). Gibt `null` zurück, wenn gar kein Vertragssignal im Text ist. Stelle für spätere echte KI-Extraktion ist im Code klar mit "AI EXTRACTION HOOK" markiert. Details/Annahmen in `contracts-logic/README.md`.

[2026-09-08] [terminal] [D] — Reminder-Scheduler-Job implementiert (`runReminderCheck` in `contracts-logic/src/scheduler.ts`): findet fällige, nicht gesendete Reminder gegen die `reminders`-Tabelle, respektiert `snoozed_until`, setzt `sent`, ruft optionalen Zustell-Callback (`onDue`) auf — bei Fehler im Callback bleibt der Reminder unsent und wird beim nächsten Lauf erneut versucht. Plus `startDailyReminderScheduler` für einen simplen 24h-Dauerlauf und ein CLI (`npm run scheduler:once` / `scheduler:daemon`). DB-Schicht läuft gegen SQLite (`better-sqlite3`), Tabellenform an `contracts/db-schema.sql` angelehnt (nur `contracts`/`reminders`, camelCase↔snake_case-Mapping in `contracts-logic/src/db.ts`).

[2026-09-08] [terminal] [D] — 14 Vitest-Tests (Extraktion + Scheduler) grün, `tsc --noEmit` sauber, CLI end-to-end manuell gegen SQLite-Datei verifiziert (Reminder wird beim ersten Lauf gefunden und als gesendet markiert, beim zweiten Lauf idempotent nicht erneut gemeldet). Track D fertig für diesen Durchstich, Status auf "fertig" gesetzt.

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

(noch keine Änderungen seit Track 0)

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- ~~api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.~~ **Beantwortet (Web, 08.09.):** kein Kürzen, war Absicht/Versehen — YAML wurde nachgezogen, alle 11 Felder jetzt drin.
- ~~api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.~~ **Beantwortet (Web, 08.09.):** beide Felder in der YAML ergänzt.
- **[D, 08.09.]** `LOW_CONFIDENCE_THRESHOLD` (Schwelle, ab der `extractedConfidence` als "niedrig" gilt und die UI einen Review-Schritt zeigen muss) ist kein Teil des Track-0-Contracts — `ai-adapter-interface.ts` legt nur das Feld fest, keinen Schwellwert. Track D hat lokal `0.6` in `contracts-logic/src/types.ts` angenommen. Falls Track C (iOS) und Track F (Web) denselben Schwellwert für ihre Review-UI brauchen, sollte der Wert in einen gemeinsamen Contract wandern (z.B. `design-tokens.json` oder `ai-adapter-interface.ts`) statt in jedem Track separat geraten zu werden.
- **[D, 08.09.]** Kleine Inkonsistenz zwischen Contract-Dateien: `ai-adapter-interface.ts` markiert `contractEnd`, `cancellationDeadline` und `cancellationPeriodDays` als `| null` (nullable), `api-spec.yaml`s `Contract`-Schema aber nur `contractStart` als `nullable: true` — die anderen drei Felder fehlt `nullable: true`. Vermutlich nur ein Versehen beim Nachziehen der YAML (ähnlich der beiden oben schon behobenen Lücken). Track D hat sich an `ai-adapter-interface.ts` gehalten (alle vier Felder nullable), da das laut Auftrag das verbindlichere Interface ist — Track A (Backend, das die YAML umsetzt) sollte das gegenchecken.
- **[D, 08.09.]** Es gibt kein installierbares gemeinsames Package für `contracts/*.ts`, aus dem Tracks direkt importieren könnten — Track D hat die relevanten Typen deshalb in `contracts-logic/src/types.ts` dupliziert (mit Kommentar, manuell nachzuziehen). Falls mehr Tracks TypeScript nutzen (z.B. E — Antwort & Signatur, F — Web), könnte sich ein gemeinsames `contracts`-npm-Package lohnen, das ist aber eine plattformübergreifende Entscheidung, keine, die Track D allein treffen sollte.

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)
