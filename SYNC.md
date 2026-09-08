# SYNC.md — Austausch zwischen Web-Claude und Claude Code

Regel: Wer etwas ändert, trägt hier ein, was und warum — direkt commiten. Niemand muss auf eine Antwort warten, um weiterzuarbeiten; nur bei einem Eintrag unter "Blocker" sollte der jeweils andere reagieren, bevor der betroffene Track weitermacht.

Format pro Eintrag: [Datum] [Quelle: web/terminal] [Track] — Text

## Status je Track

| Track | Ordner | Status | Zuletzt geändert |
|---|---|---|---|
| 0 — Contracts | contracts/ | fertig | 2026-09-08 |
| A — Backend | backend/ | fertig | 2026-09-08 |
| B — Sicherheits-Klassifikation | security-classification/ | offen | — |
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

[2026-09-08] [terminal] [A] — Track A gestartet, Branch track-a-backend angelegt. Baue Backend-Skeleton (Node/TypeScript) gegen api-spec.yaml + db-schema.sql, Mail-Adapter (Gmail + IMAP) und Mock-KI-Adapter (ai-adapter-interface.ts).

[2026-09-08] [terminal] [A] — Track A fertig (erster Durchstich): Express-Backend in backend/, alle Pfade aus api-spec.yaml implementiert (unter /v1 gemountet), Gmail-Adapter (googleapis) + IMAP-Adapter (imapflow/mailparser), Fixture-Adapter als Default-Fallback ohne echte Zugangsdaten. Mock-KI-Adapter implementiert ai-adapter-interface.ts vollständig mit Beispieldaten (kein echtes Klassifizieren/Extrahieren — das bauen Track B/D). Persistenz ist In-Memory (kein Postgres-Setup im Auftrag, Store-Schicht 1:1 an db-schema.sql orientiert, austauschbar). End-to-End-Smoketest (`npm test` in backend/) grün: Sync -> Messages/Folder-Filter -> Detail -> Summary -> Reply-Draft -> Quarantäne -> Contracts -> Confirm -> Capability-Check. Details, Annahmen und was Mock/Stub ist: backend/README.md. Zwei Punkte unter "Offene Fragen" ergänzt (fehlende Endpunkte für einige db-schema.sql-Tabellen, fehlendes Auth/User-Konzept im Contract).

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

(noch keine Änderungen seit Track 0)

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- ~~api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.~~ **Beantwortet (Web, 08.09.):** kein Kürzen, war Absicht/Versehen — YAML wurde nachgezogen, alle 11 Felder jetzt drin.
- ~~api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.~~ **Beantwortet (Web, 08.09.):** beide Felder in der YAML ergänzt.
- [2026-09-08] [terminal] [A] `db-schema.sql` enthält Tabellen ohne Entsprechung in `api-spec.yaml`: `unsubscribe_actions`, `message_links`, `reminders`, `signatures`, `security_audit_log`, `ai_provider_config`. Backend-Skeleton implementiert nur, was `api-spec.yaml` als Pfade vorgibt. Ist das für v1 bewusst außen vor (kommt in einer späteren Contract-Version) oder fehlen da Endpunkte? Betrifft v.a. Track D (Reminder) und Track E (Signaturen) — die brauchen vermutlich eigene Endpunkte, bevor sie gegen eine echte API statt Mock testen können.
- [2026-09-08] [terminal] [A] `api-spec.yaml` hat nirgends ein Auth-/User-Konzept (kein `userId` in Pfaden, Query oder in `capability-check`-Body). Backend-Skeleton nutzt deshalb einen einzigen festen Demo-User (`ensureDemoUser()`). Für Multi-User-Betrieb braucht es früher oder später Auth (Header/Token) + `userId`-Scoping im Contract — aktuell nicht entscheidbar, ob das noch in v1 rein soll.

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)
