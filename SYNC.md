# SYNC.md — Austausch zwischen Web-Claude und Claude Code

Regel: Wer etwas ändert, trägt hier ein, was und warum — direkt commiten. Niemand muss auf eine Antwort warten, um weiterzuarbeiten; nur bei einem Eintrag unter "Blocker" sollte der jeweils andere reagieren, bevor der betroffene Track weitermacht.


**Kein Mensch als Vermittler:** Web-Claude prüft `SYNC.md` (main + alle Track-Branches) eigenständig und regelmäßig auf offene Fragen und Blocker und beantwortet/entscheidet direkt dort im jeweiligen Branch — ohne dass Massimo Inhalte zwischen den Chats kopieren muss. Terminal liest entsprechend vor jedem Start den aktuellen Stand aus `SYNC.md` im eigenen Branch. Aufgaben in eine Richtung laufen über eigene Warteschlangen-Dateien: `WEB_INBOX.md` (Web → Terminal) und `TERMINAL_INBOX.md` (Terminal → Web), gleiches Protokoll (offen → erledigt: <hash>).

**Große Contract-Änderungen vorher ankündigen:** Contract-Änderungen (`contracts/*`), die über eine reine Ergänzung hinausgehen (z.B. neue Kernfunktionalität wie frei anlegbare Ordner), bitte VOR dem Commit als `[offen]` in der jeweiligen Inbox-Datei oder als Frage in "Offene Fragen" ankündigen, nicht erst danach dokumentieren. Kleinere Ergänzungen (fehlende Felder, zusätzliche Tabellen für bereits vereinbarte Features) können weiter direkt umgesetzt und im Nachhinein dokumentiert werden. (Ergänzt 08.09. auf Vorschlag von Web, siehe WEB_INBOX.md.)

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

[2026-09-08] [web] [0] — `db-schema.sql` um sechs Sicherheits-Tabellen ergänzt (vollständige Lücken-Analyse): `message_attachments` (Anhang-Scan), `user_privacy_settings` (Tracking-Pixel/Remote-Bilder blocken), `user_security_settings` + `user_sessions` (2FA + Remote-Logout für den driftmail-Account selbst), `fraud_alerts` (dedizierte CEO-Fraud-Warnung), `data_retention_policy` (DSGVO-Aufbewahrung). Betrifft Track A (Backend-Logik), Track B (Anhang-Scan-Implementierung), alle UI-Tracks (Einstellungen-Screens).

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.


[2026-09-08] [web] [0] — `db-schema.sql` ergänzt: neue Tabelle `user_ai_preference` (User-Wahl kostenloser Standard vs. eigener bezahlter KI-Zugang/BYOK, verschlüsselter API-Key). Routing prueft dies vor der `ai_provider_config`-Kaskade. Betrifft Track A (Routing-Logik) und alle UI-Tracks (Einstellungs-Screen "KI-Qualität").
[2026-09-08] [terminal] [0] — Push nach main scheitert mit 403 "Permission denied" (authentifiziert als Massim1701, aber ohne Schreibrecht). Kein Keychain-Problem: `git credential fill` liefert denselben fine-grained PAT wie `gh auth token`. `gh api repos/.../driftmail -q .permissions` zeigt zwar `push:true`, das spiegelt aber die Owner-Rolle des Accounts wider, nicht die eigene Berechtigungsliste des eingeschränkten Tokens — irreführend, nicht verlässlich zur Diagnose nutzen. Workaround-Versuch mit `git -c http.extraHeader="Authorization: Bearer $TOKEN" push` hat NICHT geholfen (anderer Fehler: "invalid credentials"). Tatsächliche Ursache: Token hat für `driftmail` (noch) keine "Contents: Read and write"-Berechtigung gesetzt/gespeichert. Fix liegt bei Massimo in den GitHub-Token-Settings, nicht im Code.

[2026-09-08] [terminal] [0] — Blocker erledigt: Massimo hat einen klassischen PAT mit vollem `repo`-Scope erzeugt, damit erfolgreich nach main gepusht (Commits `1903164`, `263af99`). Der fine-grained PAT bleibt weiter ungeklärt (nicht mehr nachverfolgt, da Workaround funktioniert) -- fuer zukuenftige Pushes wird ggf. wieder ein Token gebraucht, siehe Hinweis in der naechsten Session.

[2026-09-08] [terminal] [A] — Track A gestartet, Branch track-a-backend angelegt. Baue Backend-Skeleton (Node/TypeScript) gegen api-spec.yaml + db-schema.sql, Mail-Adapter (Gmail + IMAP) und Mock-KI-Adapter (ai-adapter-interface.ts).

[2026-09-08] [terminal] [A] — Track A fertig (erster Durchstich): Express-Backend in backend/, alle Pfade aus api-spec.yaml implementiert (unter /v1 gemountet), Gmail-Adapter (googleapis) + IMAP-Adapter (imapflow/mailparser), Fixture-Adapter als Default-Fallback ohne echte Zugangsdaten. Mock-KI-Adapter implementiert ai-adapter-interface.ts vollständig mit Beispieldaten (kein echtes Klassifizieren/Extrahieren — das bauen Track B/D). Persistenz ist In-Memory (kein Postgres-Setup im Auftrag, Store-Schicht 1:1 an db-schema.sql orientiert, austauschbar). End-to-End-Smoketest (`npm test` in backend/) grün: Sync -> Messages/Folder-Filter -> Detail -> Summary -> Reply-Draft -> Quarantäne -> Contracts -> Confirm -> Capability-Check. Details, Annahmen und was Mock/Stub ist: backend/README.md. Zwei Punkte unter "Offene Fragen" ergänzt (fehlende Endpunkte für einige db-schema.sql-Tabellen, fehlendes Auth/User-Konzept im Contract).

[2026-09-08] [terminal] [A] — Track A wieder "in Arbeit": zieht die Ordner-Contract-Änderung nach (fester Folder-Enum -> benutzerdefinierte Ordner, siehe "Contract-Änderungen" oben, Commit `734781e`). main in track-a-backend gemergt (contracts/ + neue Security/Privacy/Sessions/Fraud/Retention/AI-Preference/Shipments-Tabellen, letztere für Track A vorerst ignoriert, betreffen andere Tracks).

[2026-09-08] [terminal] [A] — Track A wieder fertig: Ordner-Contract-Änderung vollständig nachgezogen.
- **types.ts:** `Folder`-Enum entfernt, dafür `SystemFolderKey` (nur für `folders.system_key`) + neues `FolderRecord`/`ApiFolder`. `MessageRecord.folder`/`ApiMessage.folder` -> `folderId`.
- **db/store.ts:** neue `folders`-Collection mit CRUD (`createFolder`/`listFolders`/`getFolder`/`getSystemFolder`/`updateFolder`/`deleteFolder`). `ensureDemoUser()` legt jetzt zusätzlich die 5 System-Ordner an (Namen/Icons/Reihenfolge 1:1 aus `design-tokens.json` → `systemFolders.defaults`). `quarantineMessage()` löst den Ziel-Ordner jetzt über `getSystemFolder(userId, "quarantaene")` auf (User wird über die mail_account der Nachricht ermittelt, da messages kein eigenes userId-Feld hat). `updateMessageFolder` -> `moveMessage(id, folderId)`.
- **mail/sync.ts:** `classificationToFolder` (String-Enum) ersetzt durch `resolveFolderId` (löst gegen `store.getSystemFolder` auf, spam/phishing -> Systemordner "spam", sonst "sonstiges").
- **routes/folders.ts (neu):** `GET/POST /folders`, `PATCH/DELETE /folders/:folderId` gemäß api-spec.yaml. System-Ordner nicht löschbar (400); `quarantaene`/`spam` zusätzlich nicht umbenennbar (400 bei PATCH `name`), Icon/sortOrder bei diesen beiden aber änderbar (Contract schränkt das nicht ein).
- **routes/messages.ts:** `GET /messages` nutzt `folderId`-Query statt `folder`; neuer Endpunkt `POST /messages/:messageId/move` (400 bei fehlender/ungültiger `folderId`).
- **Design-Entscheidung (nicht im Contract geregelt):** beim Löschen eines eigenen Ordners werden dessen Nachrichten automatisch in den System-Ordner "sonstiges" verschoben (statt Löschen bei nicht-leerem Ordner abzulehnen), da `messages.folder_id` laut Schema `NOT NULL`/FK ist und nie ins Leere zeigen darf. Details/Begründung: `backend/README.md` Abschnitt "Ordner (benutzerdefiniert)".
- Smoketest (`src/smoketest.ts`) um Ordner-Flow erweitert (Liste der 5 System-Ordner, eigenen Ordner anlegen/umbenennen/löschen, Nachricht verschieben, Ablehnung von Umbenennen/Löschen bei System-Ordnern). `npm test` und `npm run typecheck` grün, `npm run build` erfolgreich.
- **Grenzen/Platzhalter unverändert gegenüber erstem Durchstich** (siehe README "Was ist echt, was ist Mock/Stub" + "Annahmen"): weiterhin In-Memory-Persistenz, kein Auth/Multi-User, KI weiterhin Mock. Ordner-Endpunkte sind wie der Rest des Skeletons nicht nach `userId` aus dem Request gescoped (kein Auth im Contract), sondern arbeiten intern immer gegen den Demo-User.
- **Übergabe an andere Tracks:** Track C/F (die laut SYNC.md ebenfalls die alte Folder-Enum genutzt hatten) müssen ihre Aufrufe auf `folderId` (UUID) statt `folder` (String) umstellen und Ordnernamen/-icons jetzt per `GET /folders` abfragen statt sie hart zu kodieren.

[2026-09-08] [terminal] [A] — Track A wieder "in Arbeit" -> "fertig": Auto-Delete-Pfad für die neue Spam-Unterkategorie nachgezogen (`WEB_INBOX.md` "Neue Spam-Unterkategorie fuer aggressives Auto-Loeschen", Contract-Ergänzung `message_security.spam_subcategory` bereits von Web/Track 0 committet, main in track-a-backend gemergt).
- **mail/sync.ts:** neuer Zweig vor der Ordner-Zuordnung: `classification === "spam"` **und** `spamSubcategory` in `["adult", "gambling"]` -> Nachricht wird **nicht persistiert** (kein `messages`-Eintrag, keine `message_security`-Zeile, keine Quarantäne, kein 30-Tage-Aufheben, kein Undo). `generic`/`marketing`-Spam und `phishing` laufen unverändert über die bestehende Logik. `syncAccount()` gibt zusätzlich `autoDeleted: number` zurück.
- **Design-Entscheidung (2026-09-08):** "gar nicht erst persistieren" statt "persistieren + sofort löschen" (beides laut Auftrag vertretbar) — Begründung, Dedupe-Behelf (`store.autoDeletedHeaders`, da `findMessageByHeader` diese Mails naturgemäß nie findet) und Audit-Log-Entscheidung ausführlich in `backend/README.md` Abschnitt "Auto-Delete: adult/gambling-Spam".
- **Audit-Log:** `security_audit_log` bekommt einen Schreiber (`store.logSecurityAudit()`, `action = 'auto_deleted_adult_gambling_spam'`, `messageId = null`) — Transparenz für den User, warum eine Mail fehlen könnte, ohne den Inhalt preiszugeben (Tabelle hat kein Freitextfeld). Weiterhin kein `GET`-Endpunkt (kein Contract-Pfad dafür).
- **ai/types.ts, ai/mockAdapter.ts, types.ts, mappers.ts:** `spamSubcategory` durchgängig gespiegelt (Interface, internes Record, API-Shape, Mapper). Mock-Adapter liefert `spamSubcategory` über simple Keyword-Heuristik (z.B. "casino"/"jackpot" -> `gambling`) — NICHT echte Klassifikation, wie der Rest des Mock-Adapters. Echte Erkennung baut Track B; Integration (Mock-Werte durch Track-B-Ausgabe ersetzen) ist ein separater, noch offener Schritt.
- **Fixtures/Smoketest:** neue Fixture-Mail (eindeutiger Glücksspiel-Spam) in `mail/fixtureAdapter.ts`. Smoketest prüft: Fixture wird nicht persistiert (`findMessageByHeader` liefert `undefined`), genau 1 Audit-Log-Eintrag, wiederholter Sync dedupliziert korrekt (kein zweiter Audit-Log-Eintrag). `npm test` und `npx tsc --noEmit` grün.
- **Qualitäts-Checkliste angewendet:** Grenzen benannt (Mock-Erkennung, In-Memory-Dedupe statt DB-Constraint — siehe README); Design-Entscheidungen dokumentiert (README-Abschnitt, s.o.); Edge Case wiederholter Sync behandelt und getestet; Tests grün, Typprüfung sauber; Übergabe an Track B (echte `spamSubcategory`-Erkennung, Integration in separatem Schritt) explizit benannt.

## Contract-Änderungen (wichtig — bricht ggf. andere Tracks)

Jede Änderung an einer Datei in contracts/ kommt hier rein, auch klein. Andere Tracks prüfen bei jedem Pull kurz diesen Abschnitt.

**[2026-09-08] [web] [0] — WICHTIGE CONTRACT-ÄNDERUNG:** Feste Ordner-Enum ersetzt durch benutzerdefinierte Ordner (User-Anforderung: Ordner anlegen/umbenennen/Mails verschieben). Änderungen:
- **db-schema.sql:** neue Tabelle `folders` (id, user_id, name, icon, is_system, system_key, sort_order). `messages.folder` (Enum-Text) ersetzt durch `messages.folder_id` (FK auf folders.id).
- - **api-spec.yaml:** `Folder`-Schema von Enum zu Objekt geändert ({id, name, icon, isSystem, systemKey, sortOrder}). Neue Endpunkte: `GET/POST /folders`, `PATCH/DELETE /folders/{folderId}`, `POST /messages/{messageId}/move`. `Message.folder` → `Message.folderId`. `/messages` Query-Param `folder` → `folderId`.
  - - **design-tokens.json:** `folders`-Array ersetzt durch `systemFolders.defaults` (gleiche 5 System-Ordner als Default-Namen, aber umbenennbar außer quarantaene/spam) + `customFolder.defaultIcon` für neue User-Ordner.
   
    - **Betrifft alle Tracks, die schon gegen die alte Folder-Enum gebaut haben** (insbesondere A/Backend, C/iOS, F/Web — bitte prüfen und anpassen). Kein Blocker, aber bitte vor dem nächsten Merge nach main berücksichtigen.

**[2026-09-08] [terminal] [0] — Umgesetzt** (Commit `734781e`): Die oben angekündigte Ordner-Umstellung war Stunden lang nur angekündigt, nicht in den Contract-Dateien. Jetzt tatsächlich umgesetzt in `db-schema.sql`/`api-spec.yaml`/`design-tokens.json` wie beschrieben. Track A/C/F werden jetzt entsprechend angepasst (laufende Arbeit, siehe Track-Branches).

## Offene Fragen

Fragen, die ein Track nicht selbst entscheiden kann, weil sie einen Contract oder eine plattformübergreifende Entscheidung betreffen.

- ~~api-spec.yaml `SecurityResult` unvollständig gegenüber `ai-adapter-interface.ts`/`db-schema.sql`.~~ **Beantwortet (Web, 08.09.):** kein Kürzen, war Absicht/Versehen — YAML wurde nachgezogen, alle 11 Felder jetzt drin.
- ~~api-spec.yaml `Contract`-Schema fehlt `contractStart` und `extractedConfidence`.~~ **Beantwortet (Web, 08.09.):** beide Felder in der YAML ergänzt.
- [2026-09-08] [terminal] [A] `db-schema.sql` enthält Tabellen ohne Entsprechung in `api-spec.yaml`: `unsubscribe_actions`, `message_links`, `reminders`, `signatures`, `security_audit_log`, `ai_provider_config`. Backend-Skeleton implementiert nur, was `api-spec.yaml` als Pfade vorgibt. Ist das für v1 bewusst außen vor (kommt in einer späteren Contract-Version) oder fehlen da Endpunkte? Betrifft v.a. Track D (Reminder) und Track E (Signaturen) — die brauchen vermutlich eigene Endpunkte, bevor sie gegen eine echte API statt Mock testen können.
- [2026-09-08] [terminal] [A] `api-spec.yaml` hat nirgends ein Auth-/User-Konzept (kein `userId` in Pfaden, Query oder in `capability-check`-Body). Backend-Skeleton nutzt deshalb einen einzigen festen Demo-User (`ensureDemoUser()`). Für Multi-User-Betrieb braucht es früher oder später Auth (Header/Token) + `userId`-Scoping im Contract — aktuell nicht entscheidbar, ob das noch in v1 rein soll.

## Qualitäts-Checkliste (vor Status "fertig" je Track)

- [ ] Grenzen explizit benannt: was ist Platzhalter, was ist echt umgesetzt
- [ ] Jede eigene Design-Entscheidung dokumentiert (Datum + Begründung), nicht stillschweigend getroffen
- [ ] Edge Cases behandelt, nicht nur der Erfolgsfall
- [ ] Tests vorhanden und grün, Typprüfung sauber
- [ ] Klare Übergabe: was der aufrufende Track (z.B. Backend/UI) noch selbst tun muss

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)
