# SYNC.md — Austausch zwischen Web-Claude und Claude Code

Regel: Wer etwas ändert, trägt hier ein, was und warum — direkt commiten. Niemand muss auf eine Antwort warten, um weiterzuarbeiten; nur bei einem Eintrag unter "Blocker" sollte der jeweils andere reagieren, bevor der betroffene Track weitermacht.


**Kein Mensch als Vermittler:** Web-Claude prüft `SYNC.md` (main + alle Track-Branches) eigenständig und regelmäßig auf offene Fragen und Blocker und beantwortet/entscheidet direkt dort im jeweiligen Branch — ohne dass Massimo Inhalte zwischen den Chats kopieren muss. Terminal liest entsprechend vor jedem Start den aktuellen Stand aus `SYNC.md` im eigenen Branch. Aufgaben in eine Richtung laufen über eigene Warteschlangen-Dateien: `WEB_INBOX.md` (Web → Terminal) und `TERMINAL_INBOX.md` (Terminal → Web), gleiches Protokoll (offen → erledigt: <hash>).

**Große Contract-Änderungen vorher ankündigen:** Contract-Änderungen (`contracts/*`), die über eine reine Ergänzung hinausgehen (z.B. neue Kernfunktionalität wie frei anlegbare Ordner), bitte VOR dem Commit als `[offen]` in der jeweiligen Inbox-Datei oder als Frage in "Offene Fragen" ankündigen, nicht erst danach dokumentieren. Kleinere Ergänzungen (fehlende Felder, zusätzliche Tabellen für bereits vereinbarte Features) können weiter direkt umgesetzt und im Nachhinein dokumentiert werden. (Ergänzt 08.09. auf Vorschlag von Web, siehe WEB_INBOX.md.)

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
| F — Web-Fallback-UI | web/ | fertig | 2026-09-08 |

Status-Werte: offen · in arbeit · fertig · blockiert

## Änderungsprotokoll

[2026-09-08] [web] [0] — Contracts angelegt: db-schema.sql, api-spec.yaml, ai-adapter-interface.ts, design-tokens.json. Alle Tracks können starten.

[2026-09-08] [web] [0] — `db-schema.sql` um sechs Sicherheits-Tabellen ergänzt (vollständige Lücken-Analyse): `message_attachments` (Anhang-Scan), `user_privacy_settings` (Tracking-Pixel/Remote-Bilder blocken), `user_security_settings` + `user_sessions` (2FA + Remote-Logout für den driftmail-Account selbst), `fraud_alerts` (dedizierte CEO-Fraud-Warnung), `data_retention_policy` (DSGVO-Aufbewahrung). Betrifft Track A (Backend-Logik), Track B (Anhang-Scan-Implementierung), alle UI-Tracks (Einstellungen-Screens).

[2026-09-08] [terminal] [0] — Contract-Review: zwei Lücken zwischen den Contract-Dateien gefunden, siehe "Offene Fragen" unten. Kein Code geändert, nur geprüft.


[2026-09-08] [web] [0] — `db-schema.sql` ergänzt: neue Tabelle `user_ai_preference` (User-Wahl kostenloser Standard vs. eigener bezahlter KI-Zugang/BYOK, verschlüsselter API-Key). Routing prueft dies vor der `ai_provider_config`-Kaskade. Betrifft Track A (Routing-Logik) und alle UI-Tracks (Einstellungs-Screen "KI-Qualität").
[2026-09-08] [terminal] [0] — Push nach main scheitert mit 403 "Permission denied" (authentifiziert als Massim1701, aber ohne Schreibrecht). Kein Keychain-Problem: `git credential fill` liefert denselben fine-grained PAT wie `gh auth token`. `gh api repos/.../driftmail -q .permissions` zeigt zwar `push:true`, das spiegelt aber die Owner-Rolle des Accounts wider, nicht die eigene Berechtigungsliste des eingeschränkten Tokens — irreführend, nicht verlässlich zur Diagnose nutzen. Workaround-Versuch mit `git -c http.extraHeader="Authorization: Bearer $TOKEN" push` hat NICHT geholfen (anderer Fehler: "invalid credentials"). Tatsächliche Ursache: Token hat für `driftmail` (noch) keine "Contents: Read and write"-Berechtigung gesetzt/gespeichert. Fix liegt bei Massimo in den GitHub-Token-Settings, nicht im Code.

[2026-09-08] [terminal] [0] — Blocker erledigt: Massimo hat einen klassischen PAT mit vollem `repo`-Scope erzeugt, damit erfolgreich nach main gepusht (Commits `1903164`, `263af99`). Der fine-grained PAT bleibt weiter ungeklärt (nicht mehr nachverfolgt, da Workaround funktioniert) -- fuer zukuenftige Pushes wird ggf. wieder ein Token gebraucht, siehe Hinweis in der naechsten Session.

[2026-09-08] [terminal] [F] — Web-App-Shell aufgesetzt: Vite + React + TypeScript in web/, dazu ein abhängigkeitsfreier Mock-Server (nur node:http) in web/mock-server/, der alle Endpunkte aus contracts/api-spec.yaml gegen Beispieldaten bedient. UI zeigt die 5 Ordner aus design-tokens.json (Wichtig/Sonstiges/Rechnungen/Quarantäne/Spam), Nachrichtenliste, Detailansicht mit Security-Badge (alle 11 SecurityResult-Felder), Aktionen für Quarantäne/Zusammenfassung/Antwortentwurf. Styling ausschließlich über CSS-Variablen aus contracts/design-tokens.json, Light/Dark/System-Theme umsetzt. MailSummary.source ist im Mock immer "cloud_fallback", wie im Auftrag vorgegeben (kein On-Device im Browser). tsc -b und vite build laufen fehlerfrei durch. Details/Start-Anleitung/Annahmen in web/README.md.

[2026-09-08] [terminal] [F] — Status auf "fertig" gesetzt. Kein Contract geändert (siehe unten), eine offene Frage zu Quarantäne-Gründen eingetragen.

[2026-09-08] [terminal] [F] — Status auf "in arbeit" gesetzt: Web-Skeleton wird an die neue Ordner-Contract-Änderung (Commit `734781e`, s.o.) angepasst — fester 5er-Enum wird durch die echte `Folder`-Objekt-API (`GET/POST /folders`, `PATCH/DELETE /folders/{folderId}`, `POST /messages/{messageId}/move`) ersetzt.

[2026-09-08] [terminal] [F] — Status auf "fertig" gesetzt: Web-Skeleton auf die neue Ordner-Contract-Änderung nachgezogen. Details:
- `src/types.ts`: `Folder` von String-Enum auf Objekt `{id, name, icon, isSystem, systemKey, sortOrder}` umgestellt (`SystemFolderKey` neu als reiner Marker). `Message.folder` → `Message.folderId` (UUID).
- `src/api.ts`: neue Client-Methoden `listFolders`, `createFolder`, `updateFolder`, `deleteFolder`, `moveMessage`; `listMessages(folderId?)` nutzt jetzt den `folderId`-Query-Param statt `folder`. `request()` behandelt 204-Antworten (für `DELETE /folders/{id}`) ohne JSON-Parse-Fehler.
- `mock-server/data.mjs` + `server.mjs`: 5 System-Ordner (`is_system`, `system_key` wie gehabt, feste UUIDs) plus ein Beispiel-Ordner "Familie" (eigener Ordner, `is_system:false`) mit eigener Beispiel-Nachricht. Neue Endpunkte `GET/POST /folders`, `PATCH/DELETE /folders/{folderId}`, `POST /messages/{messageId}/move` exakt nach `api-spec.yaml`-Schema implementiert und per curl gegen die Schemas verifiziert (Felder, Statuscodes 200/201/204/400/403/404). `GET /messages` filtert jetzt über `folderId` statt `folder`. Alle Nachrichten tragen `folderId` statt `folder`.
- Server-seitige Regeln (nicht im Contract-Text explizit, aber aus `design-tokens.json` `systemFolders.defaults[].renamable` abgeleitet): `PATCH` auf `quarantaene`/`spam` mit `name`/`icon` im Body → 403; `DELETE` auf jedem System-Ordner → 403. Das schützt auch dann, wenn die UI-Sperre umgangen wird.
- **Eigene Design-Entscheidung (nicht im Contract vorgegeben):** was passiert mit Nachrichten in einem gelöschten (eigenen) Ordner? `api-spec.yaml` sagt dazu nichts. Entscheidung: Mock-Server verschiebt sie beim `DELETE /folders/{id}` automatisch nach "Sonstiges" statt sie zu verlieren, analog zu üblichem Mail-Client-Verhalten. Nur Mock-Verhalten — Track A muss das für das echte Backend selbst festlegen (z. B. ob stattdessen eine Nutzer-Bestätigung/Warnung nötig ist, wenn der Ordner nicht leer ist).
- UI: `FolderSidebar` lädt Ordner jetzt über `GET /folders` statt aus einer festen Konstante; neues `src/folderMeta.ts` hält die reinen Darstellungs-Metadaten (`colorRole`/`muted`/`renamable`) für die 5 System-Ordner, 1:1 aus `design-tokens.json` `systemFolders.defaults` gespiegelt (diese Felder sind nicht Teil des API-`Folder`-Objekts). Neuer Ordner per Eingabefeld+Button anlegbar; Umbenennen per Inline-Edit (Stift-Icon, nur bei `renamable`-Ordnern); Löschen per Papierkorb-Icon nur bei eigenen Ordnern (System-Ordner haben keinen Löschen-Button). `App.tsx` verwaltet `activeFolder` jetzt als `folderId` (UUID) statt Enum-Wert. `MessageDetailPane` bekommt zusätzlich ein "In Ordner verschieben…"-Dropdown (`POST /messages/{id}/move`), um den neuen Endpoint auch im UI-Fluss zu zeigen, nicht nur im Mock-Server.
- `tsc -b` und `vite build` laufen fehlerfrei durch (`npm run build`), `oxlint` zeigt nur dieselben (vorbestehenden) Warnings wie vor der Änderung, keine neuen Fehler. Alle neuen Mock-Endpunkte manuell per curl gegen die exakten `api-spec.yaml`-Response-Schemas getestet (create/rename/delete/move, inkl. Fehlerfälle 400/403/404).
- Grenze: kein Drag&Drop zum Verschieben von Nachrichten oder zum Umsortieren von Ordnern (nur Dropdown bzw. `PATCH sortOrder` serverseitig vorbereitet, keine UI dafür) — bewusst außerhalb des Skeleton-Scopes, siehe `web/README.md` "Annahmen / offene Punkte".
- Übergabe an Track A: Backend muss reale Foreign-Key-Semantik für `folders`/`messages.folder_id` umsetzen (inkl. der offenen Frage oben zum Löschverhalten) sowie die 403-Regeln für `quarantaene`/`spam` serverseitig genauso durchsetzen wie im Mock.

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
- (Track F, 08.09.) Die `quarantine`-Tabelle in db-schema.sql hat `reason` und `auto_delete_at`, aber api-spec.yaml exponiert dafür keinen Read-Endpoint (nur `POST /messages/{id}/quarantine` zum Erstellen). Die Web-UI zeigt in der Quarantäne-Ansicht deshalb ersatzweise die `SecurityResult`-Signale als Begründung, statt einen echten `reason`-Text. Frage an Track 0/A: soll es einen `GET`-Weg geben, um `reason`/`auto_delete_at` je Nachricht abzurufen (z. B. zusätzliches Feld auf `MessageDetail` oder eigener `/messages/{id}/quarantine`-GET)? Nicht blockierend für Track F, betrifft aber ggf. auch Track C (iOS) für dieselbe Quarantäne-Ansicht.

## Qualitäts-Checkliste (vor Status "fertig" je Track)

- [ ] Grenzen explizit benannt: was ist Platzhalter, was ist echt umgesetzt
- [ ] Jede eigene Design-Entscheidung dokumentiert (Datum + Begründung), nicht stillschweigend getroffen
- [ ] Edge Cases behandelt, nicht nur der Erfolgsfall
- [ ] Tests vorhanden und grün, Typprüfung sauber
- [ ] Klare Übergabe: was der aufrufende Track (z.B. Backend/UI) noch selbst tun muss

## Blocker

Nur eintragen, wenn ein Track wirklich nicht weiterkommt, ohne dass jemand anders etwas ändert. Bitte mit betroffenem Track markieren.

(keine — Push-Blocker vom 08.09. ist erledigt, siehe Änderungsprotokoll)


[2026-09-08] [web] [B] — Antwort auf die vier "wer macht den externen Lookup"-Fragen (senderDomainAgeDays/domainReputationScore, containsNewIban-Historie, ipReputationFlag, recipientReputation): Alle vier nach demselben Muster loesen, EINHEITLICH:

Entscheidung: security-classification/ bleibt bewusst zustandslos (kein Netzwerk, keine DB) — das ist architektonisch richtig und bleibt so, keine Contract-Aenderung am Interface noetig. Track A macht ALLE VIER Lookups als eigener Nachbearbeitungsschritt NACH dem Aufruf von analyzeMail() bzw. checkDraftForPhishing(), nicht als Erweiterung der Funktionssignaturen selbst:

1. Nach analyzeMail(rawText, headers) liefert Track A per eigenem Nachbearbeitungsschritt: senderDomainAgeDays/domainReputationScore (WHOIS/Reputationsdienst-Abfrage), ipReputationFlag (Spamhaus XBL/CBL-Abgleich gegen die sendende IP aus den Headern), containsNewIban (Abgleich der von security-classification/ erkannten IBAN gegen die IBAN-Historie des Absenders in der eigenen DB — "neu" heisst: noch nie zuvor von diesem Absender an diesen User gesehen).

2. Nach checkDraftForPhishing(bodyText, links) liefert Track A per eigenem Nachbearbeitungsschritt: recipientReputation (Abgleich der Empfaenger-Adresse gegen fraud_alerts/Empfaenger-Historie in der eigenen DB). Wie in WEB_INBOX.md spezifiziert: ist recipientReputation = "flagged" UND containsSensitiveData nicht leer, wird der UI-Warnhinweis vom Frontend deutlich schaerfer dargestellt (rote statt gelbe Sprechblase) — das ist reine UI-Logik in Track C/F basierend auf den beiden vom Backend gelieferten Feldern, keine weitere Backend-Aenderung noetig.

Begruendung fuer "Track A, nicht Contract-Erweiterung": Netzwerk-/DB-Zugriff gehoert ins Backend, das testbare, deterministische, plattformunabhaengige security-classification/-Modul soll das nicht selbst brauchen. Track A ruft das Modul auf, reichert das Ergebnis mit den vier Feldern an, bevor es an die API-Antwort geht (SecurityResult/phishing-check-Response werden also final erst im Backend vollstaendig befuellt, nicht schon von security-classification/ allein). Kein Contract-Bruch, da die Feld-Typen (TEXT/BOOLEAN/NUMERIC bzw. enum) unveraendert bleiben — nur WER sie befuellt aendert sich.

Track B kann Status "fertig" behalten, keine weitere Aenderung am Modul noetig. An Track A weitergeben: vier Nachbearbeitungsschritte einplanen (idealerweise als externe Lookup-Services/Adapter, die gemockt werden koennen, analog zum bestehenden Mock-KI-Adapter-Muster aus Track E, damit Backend-Tests nicht von echten externen Diensten abhaengen).
