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
| E — Antwort & Signatur | mail-actions/ | fertig | 2026-09-08 |
| F — Web-Fallback-UI | web/ | offen | — |

Status-Werte: offen · in arbeit · fertig · blockiert

## Änderungsprotokoll

[2026-09-08] [web] [0] — Contracts angelegt: db-schema.sql, api-spec.yaml, ai-adapter-interface.ts, design-tokens.json. Alle Tracks können starten.

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.

[2026-09-08] [terminal] [0] — Push nach main scheitert mit 403 "Permission denied" (authentifiziert als Massim1701, aber ohne Schreibrecht). Kein Keychain-Problem: `git credential fill` liefert denselben fine-grained PAT wie `gh auth token`. `gh api repos/.../driftmail -q .permissions` zeigt zwar `push:true`, das spiegelt aber die Owner-Rolle des Accounts wider, nicht die eigene Berechtigungsliste des eingeschränkten Tokens — irreführend, nicht verlässlich zur Diagnose nutzen. Workaround-Versuch mit `git -c http.extraHeader="Authorization: Bearer $TOKEN" push` hat NICHT geholfen (anderer Fehler: "invalid credentials"). Tatsächliche Ursache: Token hat für `driftmail` (noch) keine "Contents: Read and write"-Berechtigung gesetzt/gespeichert. Fix liegt bei Massimo in den GitHub-Token-Settings, nicht im Code.

[2026-09-08] [terminal] [0] — Blocker erledigt: Massimo hat einen klassischen PAT mit vollem `repo`-Scope erzeugt, damit erfolgreich nach main gepusht (Commits `1903164`, `263af99`). Der fine-grained PAT bleibt weiter ungeklärt (nicht mehr nachverfolgt, da Workaround funktioniert) -- fuer zukuenftige Pushes wird ggf. wieder ein Token gebraucht, siehe Hinweis in der naechsten Session.

[2026-09-08] [terminal] [E] — Branch `track-e-mail-actions` angelegt, Status auf "in Arbeit" gesetzt.

[2026-09-08] [terminal] [E] — mail-actions/ Modul gebaut: `draftReply(thread): Promise<string>` (Platzhalter-Template, klar markierte Stelle für echte KI-Generierung) + Signatur-Auswahlregeln (`apply_to_new`/`apply_to_replies`/`is_default`) mit `SignatureStore` als In-Memory-Stand-in für die Track-A-DB-Anbindung. TypeScript + Vitest, 28 Tests grün, `tsc --noEmit` sauber. Annahmen in mail-actions/README.md dokumentiert. Kein UI, keine Contract-Änderung.

[2026-09-08] [terminal] [E] — Fertig. Zusammenfassung: mail-actions/ liefert draftReply()-Skeleton (Platzhalter-Text, TODO-Stelle für echte KI klar markiert) und eine vollständig getestete Signatur-Auswahl-/Verwaltungslogik gegen die `signatures`-Tabelle (Default-Invariante, apply_to_new/apply_to_replies-Kontextauswahl, Account-Isolation). `composeReplyDraft()` zeigt beispielhaft, wie Track A draftReply + Signatur zusammenführen könnte. Zwei offene Fragen unten eingetragen (kein Blocker). Nicht auf iOS/B/D gewartet.

[2026-09-08] [terminal] [E] — Beide offenen Fragen von Web beantwortet bekommen und umgesetzt: (1) `draftReply` liefert jetzt `AiAdapterResult<string>` statt `Promise<string>` — Contract-Änderung in `ai-adapter-interface.ts`, betrifft Track A/C (siehe "Contract-Änderungen"). (2) Signatur-Fallback: `selectSignatureForContext` hängt jetzt die `is_default`-Signatur an, wenn kein Kandidat für den Kontext gefunden wird. mail-actions/ Tests von 28 auf 31 erweitert (alle grün), `tsc --noEmit` sauber, README aktualisiert. Track E bleibt "fertig".

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

**[2026-09-08] [terminal] [E]** — `contracts/ai-adapter-interface.ts`: `AiAdapter.draftReply` gibt jetzt `Promise<AiAdapterResult<string>>` zurück statt `Promise<string>` (Entscheidung Web, siehe "Offene Fragen" unten). **Betrifft Track A** (Route `/messages/{id}/reply-draft` muss `.data` auslesen, falls die dortige Mock-Implementierung noch die alte Signatur hat) **und Track C** (Swift-Port des Interfaces, falls schon 1:1 übernommen). mail-actions/ selbst ist bereits angepasst (`draftReply` liefert `{ data, source: "cloud_fallback" }`, Platzhalter-Logik unverändert).

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- ~~api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.~~ **Beantwortet (Web, 08.09.):** kein Kürzen, war Absicht/Versehen — YAML wurde nachgezogen, alle 11 Felder jetzt drin.
- ~~api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.~~ **Beantwortet (Web, 08.09.):** beide Felder in der YAML ergänzt.
- ~~**[E]** `draftReply(thread): Promise<string>` liefert keine Quelle (`on_device`/`cloud_fallback`).~~ **Beantwortet (Web, 08.09.) & umgesetzt (terminal, 08.09.):** `draftReply` gibt jetzt `Promise<AiAdapterResult<string>>` zurück. `ai-adapter-interface.ts` angepasst, `mail-actions/` folgt (`source: "cloud_fallback"` fest für die Platzhalter-Logik), Tests + README aktualisiert. Siehe "Contract-Änderungen" oben — betrifft Track A/C.
- ~~**[E]** Signatur-Auswahlregel bei fehlendem Kandidaten: kein Fallback auf `is_default`.~~ **Beantwortet (Web, 08.09.) & umgesetzt (terminal, 08.09.):** `selectSignatureForContext` fällt jetzt auf die `is_default`-Signatur des Accounts zurück, wenn kein Kandidat für den Kontext gefunden wird. Tests + README aktualisiert.

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)
