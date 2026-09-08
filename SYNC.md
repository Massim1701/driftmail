# SYNC.md — Austausch zwischen Web-Claude und Claude Code

Regel: Wer etwas ändert, trägt hier ein, was und warum — direkt commiten. Niemand muss auf eine Antwort warten, um weiterzuarbeiten; nur bei einem Eintrag unter "Blocker" sollte der jeweils andere reagieren, bevor der betroffene Track weitermacht.

Format pro Eintrag: [Datum] [Quelle: web/terminal] [Track] — Text

## Status je Track

| Track | Ordner | Status | Zuletzt geändert |
|---|---|---|---|
| 0 — Contracts | contracts/ | fertig | 2026-09-08 |
| A — Backend | backend/ | offen | — |
| B — Sicherheits-Klassifikation | security-classification/ | offen | — |
| C — iOS App | ios/ | fertig | 2026-09-08 |
| D — Vertrag & Reminder | contracts-logic/ | offen | — |
| E — Antwort & Signatur | mail-actions/ | offen | — |
| F — Web-Fallback-UI | web/ | offen | — |

Status-Werte: offen · in arbeit · fertig · blockiert

## Änderungsprotokoll

[2026-09-08] [web] [0] — Contracts angelegt: db-schema.sql, api-spec.yaml, ai-adapter-interface.ts, design-tokens.json. Alle Tracks können starten.

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.

[2026-09-08] [terminal] [0] — Push nach main scheitert mit 403 "Permission denied" (authentifiziert als Massim1701, aber ohne Schreibrecht). Kein Keychain-Problem: `git credential fill` liefert denselben fine-grained PAT wie `gh auth token`. `gh api repos/.../driftmail -q .permissions` zeigt zwar `push:true`, das spiegelt aber die Owner-Rolle des Accounts wider, nicht die eigene Berechtigungsliste des eingeschränkten Tokens — irreführend, nicht verlässlich zur Diagnose nutzen. Workaround-Versuch mit `git -c http.extraHeader="Authorization: Bearer $TOKEN" push` hat NICHT geholfen (anderer Fehler: "invalid credentials"). Tatsächliche Ursache: Token hat für `driftmail` (noch) keine "Contents: Read and write"-Berechtigung gesetzt/gespeichert. Fix liegt bei Massimo in den GitHub-Token-Settings, nicht im Code.

[2026-09-08] [terminal] [0] — Blocker erledigt: Massimo hat einen klassischen PAT mit vollem `repo`-Scope erzeugt, damit erfolgreich nach main gepusht (Commits `1903164`, `263af99`). Der fine-grained PAT bleibt weiter ungeklärt (nicht mehr nachverfolgt, da Workaround funktioniert) -- fuer zukuenftige Pushes wird ggf. wieder ein Token gebraucht, siehe Hinweis in der naechsten Session.

[2026-09-08] [terminal] [C] — Track C gestartet: SwiftUI-Grundgerüst gegen contracts/api-spec.yaml und design-tokens.json, Branch track-c-ios.

[2026-09-08] [terminal] [C] — Track C fertig: SwiftUI-Grundgerüst (iOS 17+) mit Onboarding-Capability-Check, 5-Ordner-Inbox, Quarantäne-Warnbanner, Nachrichtendetail mit Security-Badges. Alle vier `AiAdapter`-Funktionen aus ai-adapter-interface.ts als Swift-Protokoll + Heuristik-Stub (`OnDeviceAiAdapter`) und Cloud-Fallback-Stub implementiert. `APIClient`-Protokoll deckt alle Endpunkte aus api-spec.yaml ab: `MockAPIClient` bedient sie aus einer gebündelten JSON-Datei (10 Nachrichten über alle 5 Ordner, 2 Verträge), `RemoteAPIClient` ist ein ungetestetes URLSession-Skelett für Track A. Design-Tokens 1:1 nach Swift portiert (DesignSystem/DesignTokens.swift), inkl. Light/Dark. Volle Xcode-Umgebung war in dieser Session verfügbar (nicht nur Quellcode wie im Auftrag als Fallback vorgesehen): Projekt gegen iphonesimulator gebaut (BUILD SUCCEEDED) und auf einem iPhone-17-Pro-Simulator installiert/gestartet; dabei einen echten Decoding-Bug gefunden und gefixt (api-spec.yaml mischt `format: date` und `format: date-time`, ein einzelner `.iso8601`-Decoder crashte beim Start — jetzt behoben über einen kombinierten Decoder, siehe ios/DriftmailApp/Networking/DateDecoding.swift). Alle vier Kernscreens per Screenshot verifiziert. Details, Annahmen und was ungetestet blieb: ios/README.md.

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

(noch keine Änderungen seit Track 0)

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- ~~api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.~~ **Beantwortet (Web, 08.09.):** kein Kürzen, war Absicht/Versehen — YAML wurde nachgezogen, alle 11 Felder jetzt drin.
- ~~api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.~~ **Beantwortet (Web, 08.09.):** beide Felder in der YAML ergänzt.
- [C, 08.09.] api-spec.yaml mischt `format: date-time` (z. B. `Message.receivedAt`) und `format: date` (z. B. `Contract.contractEnd`, `MailSummary.deadline`) im selben Dokument, ohne dass das explizit als Absicht markiert ist. Für iOS kein Blocker — `ios/DriftmailApp/Networking/DateDecoding.swift` akzeptiert defensiv beide Formate beim Decodieren. Aber: bitte bei Track A verifizieren, dass das reale Backend tatsächlich beide Formate exakt so ausgibt (volles ISO-8601 mit Zeit vs. reines `yyyy-MM-dd`), bevor der Mock gegen den echten Server getauscht wird — sonst bricht das Decoding client-seitig wieder.

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)
