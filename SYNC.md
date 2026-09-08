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
| D — Vertrag & Reminder | contracts-logic/ | offen | — |
| E — Antwort & Signatur | mail-actions/ | offen | — |
| F — Web-Fallback-UI | web/ | offen | — |

Status-Werte: offen · in arbeit · fertig · blockiert

## Änderungsprotokoll

[2026-09-08] [web] [0] — Contracts angelegt: db-schema.sql, api-spec.yaml, ai-adapter-interface.ts, design-tokens.json. Alle Tracks können starten.

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

(noch keine Änderungen seit Track 0)

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- **api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.** Das TS-Interface und die DB-Tabelle `message_security` haben 11 Felder, die YAML-Schema (Zeile ~202-211) nur 7 — es fehlen `senderDomainAgeDays`, `domainReputationScore`, `urgencyLanguageScore`, `containsNewIban`. Wenn Track A sich strikt an die YAML hält, fehlen der App diese Signale in der API-Antwort. Betrifft Track A (Backend) und Track B (liefert diese Felder). Frage: YAML nachziehen, oder war das Kürzen absichtlich (z.B. weil diese Felder intern bleiben sollen)?
- **api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.** Letzteres ist laut `ai-adapter-interface.ts` (Kommentar bei `ContractData.extractedConfidence`) genau das Feld, das entscheidet, ob die UI einen Review-Schritt zeigen muss ("niedrig -> User muss bestätigen"). Ohne das Feld in der API-Antwort kann Track C/F diese Logik nicht umsetzen. Betrifft Track A, C, D, F. Frage: Feld in YAML ergänzen?

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine)
