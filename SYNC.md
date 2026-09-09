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
| C — iOS App | ios/ | fertig | 2026-09-08 |
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

[2026-09-08] [terminal] [C] — Track C gestartet: SwiftUI-Grundgerüst gegen contracts/api-spec.yaml und design-tokens.json, Branch track-c-ios.

[2026-09-08] [terminal] [C] — Track C fertig: SwiftUI-Grundgerüst (iOS 17+) mit Onboarding-Capability-Check, 5-Ordner-Inbox, Quarantäne-Warnbanner, Nachrichtendetail mit Security-Badges. Alle vier `AiAdapter`-Funktionen aus ai-adapter-interface.ts als Swift-Protokoll + Heuristik-Stub (`OnDeviceAiAdapter`) und Cloud-Fallback-Stub implementiert. `APIClient`-Protokoll deckt alle Endpunkte aus api-spec.yaml ab: `MockAPIClient` bedient sie aus einer gebündelten JSON-Datei (10 Nachrichten über alle 5 Ordner, 2 Verträge), `RemoteAPIClient` ist ein ungetestetes URLSession-Skelett für Track A. Design-Tokens 1:1 nach Swift portiert (DesignSystem/DesignTokens.swift), inkl. Light/Dark. Volle Xcode-Umgebung war in dieser Session verfügbar (nicht nur Quellcode wie im Auftrag als Fallback vorgesehen): Projekt gegen iphonesimulator gebaut (BUILD SUCCEEDED) und auf einem iPhone-17-Pro-Simulator installiert/gestartet; dabei einen echten Decoding-Bug gefunden und gefixt (api-spec.yaml mischt `format: date` und `format: date-time`, ein einzelner `.iso8601`-Decoder crashte beim Start — jetzt behoben über einen kombinierten Decoder, siehe ios/DriftmailApp/Networking/DateDecoding.swift). Alle vier Kernscreens per Screenshot verifiziert. Details, Annahmen und was ungetestet blieb: ios/README.md.

[2026-09-08] [terminal] [C] — Track C: Ordner-Contract-Änderung nachgezogen (siehe unten "Contract-Änderungen", umgesetzt Commit `734781e`). Status kurzzeitig auf "in arbeit", siehe Folgeeintrag für das Ergebnis.

[2026-09-08] [terminal] [C] — Track C wieder fertig: an die neue Ordner-Contract-Änderung angepasst. `Models/Folder.swift` ist jetzt ein `Codable`/`Identifiable`/`Hashable`-Struct (id/name/icon/isSystem/systemKey/sortOrder) statt eines 5-Werte-String-Enums; `SystemFolderKey`-Enum trägt nur noch die 5 System-Schlüssel für Vergleiche (`systemKey == .quarantaene` etc.), keine feste Ordnerliste mehr. `Message`/`MessageDetail.folder` → `.folderId` (String-Referenz auf `Folder.id`). `DesignSystem/DesignTokens.swift` um `SystemFolders.defaults` (Swift-Port von design-tokens.json `systemFolders.defaults`) und `CustomFolder.defaultIcon` ergänzt. `APIClient`-Protokoll um `fetchFolders`, `createFolder`, `updateFolder`, `deleteFolder`, `moveMessage` erweitert (`fetchMessages` nimmt jetzt `folderId` statt `folder`); `MockAPIClient` implementiert alle fünf mit einfacher In-Memory-Logik gegen `MockDatabase.json` (inkl. Validierung: quarantaene/spam nicht umbenennbar, System-Ordner nicht löschbar, Nachrichten eines gelöschten Ordners wandern nach "Sonstiges"); `RemoteAPIClient` um die passenden HTTP-Aufrufe (inkl. neuer `patch`/`delete`-Hilfsmethoden) erweitert, weiterhin ungetestet gegen einen echten Server. `MockDatabase.json` hat jetzt ein `folders`-Array (5 System-Ordner + 1 Beispiel-eigener Ordner "Familie") und alle Nachrichten tragen `folderId` statt `folder`; eine 11. Beispielnachricht liegt im eigenen Ordner, um Custom Folders zu demonstrieren. `FolderListView` liest die Ordnerliste jetzt aus `AppEnvironment.folders` (neu: zentral geladen, gecacht) statt `Folder.allCases`, plus ein einfacher "+"-Button (`POST /folders`) zum Anlegen eigener Ordner. `InboxListView`/`MessageDetailView` entsprechend umgestellt; `MessageDetailView` bekam zusätzlich ein "Verschieben nach…"-Menü (`POST /messages/{id}/move`) über alle Ordner außer dem aktuellen. Build gegen iphonesimulator erneut geprüft (BUILD SUCCEEDED) und auf demselben iPhone-17-Pro-Simulator installiert/gestartet: Ordnerliste (dynamisch, inkl. "Familie"-Ordner mit korrektem Count) und Nachrichtendetail (Quarantäne-Banner + "Verschieben nach…"-Menü, Quarantäne-Button korrekt ausgeblendet) per Screenshot verifiziert. Tap-Interaktionen weiterhin nicht automatisierbar in dieser Umgebung (wie schon beim ersten Durchstich vermerkt), Root-View-Tausch als Workaround für die Screenshots genutzt und danach sauber zurückgesetzt (kein Diff in DriftmailApp.swift). Details: ios/README.md.

[2026-09-08] [terminal] [C] — Track C: Papierkorb-Nachtrag umgesetzt (WEB_INBOX.md "Fehlende Basis-Funktion entdeckt", Contract-Teil bereits Commit `156f0fd`). Status kurzzeitig "in arbeit", jetzt wieder "fertig". main wurde zuerst gemerged (u.a. Botnetz-Signale, Phishing-Check-Erweiterung, IDEEN_BACKLOG.md, Papierkorb-Contract selbst — sauberer Merge, keine Konflikte).

Umgesetzt: 6. System-Ordner `papierkorb` (`SystemFolderKey.papierkorb`, Icon `trash-2` → SF Symbol `trash.slash.fill`, weder umbenennbar noch löschbar wie quarantaene/spam — `Models/Folder.swift`, `DesignSystem/DesignTokens.swift`). `APIClient`-Protokoll um `deleteMessage(id:)` (`DELETE /messages/{messageId}`, soft delete) und `permanentlyDeleteMessage(id:)` (`DELETE /messages/{messageId}/permanent`) erweitert; `MockAPIClient` implementiert beide (`deleteMessage` verschiebt intern in den Papierkorb-Ordner wie die Quarantäne-Kurzform, `permanentlyDeleteMessage` entfernt den Eintrag endgültig aus der Mock-DB inkl. gecachter Summary); `RemoteAPIClient` um beide Pfade als Skelett ergänzt (ungetestet gegen echten Server, wie die übrigen Endpunkte). `MockDatabase.json`: Papierkorb-Ordner + 2 Beispielnachrichten (`msg-012`/`msg-013`). UI: `InboxListView` bekommt eine Swipe-Action (Löschen bzw. im Papierkorb "Endgültig löschen" mit Bestätigungsdialog), `MessageDetailView` bekommt einen zusätzlichen destruktiven Button in der Aktionsleiste (analog zum bestehenden "Verschieben nach…"-Menü, gleiches Muster wie "In Quarantäne verschieben").

Getestet: Build gegen iphonesimulator erneut geprüft (BUILD SUCCEEDED), auf einem iPhone-17-Pro-Simulator installiert/gestartet, Ordnerliste per Screenshot verifiziert — Papierkorb erscheint korrekt zwischen Spam und dem eigenen Ordner "Familie", mit eigenem Icon und korrektem Count (2). Tap-Interaktionen weiterhin nicht automatisierbar in dieser Umgebung (wie in den vorherigen beiden Einträgen vermerkt — `osascript`/System Events liefert keine zuverlässige Fenster-zu-Screenshot-Koordinatenabbildung, kein XCUITest-Target). Detailansicht/Swipe-Buttons sind daher code-verifiziert (Compiler prüft Typen/Pflichtfälle), aber nicht per Screenshot der Interaktion selbst bestätigt.

Nicht umgesetzt (Server-seitig, außerhalb Track C): Spiegeln auf die Provider-API (Gmail `messages.trash`/`messages.delete`, IMAP `\Deleted`/Expunge) — das ist Track A laut WEB_INBOX.md-Vorgabe, die App ruft nur den Contract-Endpunkt. Kein Undo/Snackbar nach dem Löschen. Keine automatische Papierkorb-Leerung (laut WEB_INBOX.md explizit nicht gefordert). Details: ios/README.md.

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
- [C, 08.09.] api-spec.yaml mischt `format: date-time` (z. B. `Message.receivedAt`) und `format: date` (z. B. `Contract.contractEnd`, `MailSummary.deadline`) im selben Dokument, ohne dass das explizit als Absicht markiert ist. Für iOS kein Blocker — `ios/DriftmailApp/Networking/DateDecoding.swift` akzeptiert defensiv beide Formate beim Decodieren. Aber: bitte bei Track A verifizieren, dass das reale Backend tatsächlich beide Formate exakt so ausgibt (volles ISO-8601 mit Zeit vs. reines `yyyy-MM-dd`), bevor der Mock gegen den echten Server getauscht wird — sonst bricht das Decoding client-seitig wieder.

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

[2026-09-09] [terminal] [0] — Die letzten beiden offenen TERMINAL_INBOX.md-Punkte (5+6) als kleinere Ergänzungen bereits vereinbarter Features direkt umgesetzt (Contract-Ankündigungsregel greift hier nicht, siehe Regel oben):
- `contracts/ai-adapter-interface.ts`: `LOW_CONFIDENCE_THRESHOLD = 0.6` als gemeinsame Konstante ergänzt (bisher nur lokal in Track D angenommen).
- `contracts/api-spec.yaml`: `MessageDetail.quarantine` (neues Schema `QuarantineInfo`: reason/autoDeleteAt/userReviewed, nullable) ergänzt, damit Track F/C die schon in der DB vorhandenen Quarantäne-Infos auch lesen können.
Details/Begründung in TERMINAL_INBOX.md Punkt 5/6. Betrifft Track A (Response befüllen), C/D/F (Werte übernehmen/anzeigen). Punkt 7 (npm-Package für contracts/*.ts) bewusst vertagt, siehe TERMINAL_INBOX.md.
