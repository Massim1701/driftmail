# driftmail — iOS App (Track C)

Erster Durchstich der iOS-App gegen die Track-0-Contracts
(`contracts/api-spec.yaml`, `contracts/design-tokens.json`,
`contracts/ai-adapter-interface.ts`, `contracts/db-schema.sql`). Läuft
komplett gegen lokale Mock-Daten, kein echtes Backend nötig. SwiftUI,
iOS 17+.

## [2026-09-08] Contract-Änderung nachgezogen: benutzerdefinierte Ordner

Der ursprüngliche Durchstich war gegen einen festen 5-Werte-Ordner-Enum
(`wichtig`/`sonstiges`/`rechnungen`/`quarantaene`/`spam`) gebaut. Dieser
Contract wurde ersetzt (SYNC.md "WICHTIGE CONTRACT-ÄNDERUNG", umgesetzt
Commit `734781e`): Ordner sind jetzt benutzerdefinierte Objekte
(anlegen/umbenennen/löschen/verschieben), die 5 System-Ordner existieren
weiterhin, sind aber Daten vom Server, keine App-Konstante mehr. Die App
wurde entsprechend angepasst — Details im Änderungsprotokoll unten unter
"Was sich mit der Ordner-Contract-Änderung geändert hat".

## [2026-09-08] Nachtrag: Papierkorb / manuelles Löschen (soft delete)

Contract-Nachtrag "Fehlende Basis-Funktion entdeckt" (WEB_INBOX.md 08.09.,
Contract-Teil Commit `156f0fd`): manuelles Löschen einer Nachricht gab es
bisher nicht (nur Quarantäne, Verschieben, automatische Spam/Phishing-
Löschregeln). Umgesetzt analog Gmail: Löschen = in einen neuen
System-Ordner "Papierkorb" verschieben (soft delete), erst von dort aus
ist "Endgültig löschen" (hard delete) möglich.

- **Neuer 6. System-Ordner** `papierkorb` (`systemKey: .papierkorb`, Icon
  `trash-2` → SF Symbol `trash.slash.fill`), analog zu den bestehenden 5:
  `Models/Folder.swift` (`SystemFolderKey`, `isRenamable`/`isTrash`),
  `DesignSystem/DesignTokens.swift` (`SystemFolders.defaults`),
  `Networking/MockData/MockDatabase.json` (Ordner + 2 Beispielnachrichten
  `msg-012`/`msg-013`). Weder umbenennbar noch löschbar, wie
  `quarantaene`/`spam`.
- **`APIClient` um zwei Endpunkte ergänzt**
  (`Networking/APIClient.swift`): `deleteMessage(id:)` →
  `DELETE /messages/{messageId}` (soft delete, verschiebt in den
  Papierkorb) und `permanentlyDeleteMessage(id:)` →
  `DELETE /messages/{messageId}/permanent` (hard delete). `MockAPIClient`
  implementiert beide (`deleteMessage` ruft intern `moveMessage` auf den
  Papierkorb-Ordner auf, genau wie die Quarantäne-Kurzform;
  `permanentlyDeleteMessage` entfernt den Eintrag endgültig aus der
  Mock-DB). `RemoteAPIClient` verdrahtet beide Pfade als Skelett
  (ungetestet gegen einen echten Server, wie die übrigen Endpunkte).
- **UI**: `InboxListView` bekommt eine Swipe-Action ("Löschen" bzw. im
  Papierkorb selbst "Endgültig löschen" mit Bestätigungsdialog);
  `MessageDetailView` bekommt einen zusätzlichen destruktiven Button in
  der Aktionsleiste (ebenfalls "Löschen"/"Endgültig löschen" je nach
  aktuellem Ordner), analog zum bestehenden "Verschieben nach…"-Menü.
- **Nicht umgesetzt** (Server-seitig, nicht Track C): das serverseitige
  Spiegeln auf die Provider-API (Gmail `messages.trash`/`messages.delete`
  bzw. IMAP `\Deleted`/Expunge) laut WEB_INBOX.md-Vorgabe — das ist
  Track A, die App ruft nur den Contract-Endpunkt auf. Keine
  Undo-/Snackbar-Funktion nach dem Löschen (Gmail-typisch, aber nicht im
  Contract gefordert). Keine automatische Papierkorb-Leerung (laut
  WEB_INBOX.md explizit nicht gefordert — Standard-Verhalten wie Gmail,
  User leert manuell oder es bleibt liegen).

## [2026-09-10] Nachtrag: Versand (`POST /messages/send`)

Contract-Nachtrag "Fehlender Senden-Endpunkt" (WEB_INBOX.md 09.09.): der
Antwortentwurf (`MessageDetailView`, `requestReplyDraft`) landete bisher in
einer reinen Anzeigekarte ohne funktionierenden Senden-Button — der Entwurf
konnte nie tatsächlich verschickt werden.

- **`APIClient` um einen Endpunkt ergänzt** (`Networking/APIClient.swift`):
  `sendMessage(inReplyToMessageId:to:subject:bodyText:)` →
  `POST /messages/send`. Nur der Antwort-Fall ist abgedeckt (kein
  "Neue Mail verfassen"-Screen in diesem Durchstich, analog Web) — das
  Backend leitet Konto + `In-Reply-To`/`References`-Header selbst aus
  `inReplyToMessageId` ab (siehe backend/README.md "Versand"), die App muss
  kein `accountId` mitgeben.
- **`APIError.blocked(reason:)`** (neuer Fall): der serverseitige
  Phishing-Check kann den Versand mit `422` verhindern — das ist ein
  erwarteter, vom Erfolgsfall inhaltlich verschiedener Ausgang, kein
  generischer Netzwerkfehler, deshalb ein eigener `APIError`-Fall statt
  `.network`.
- **`MockAPIClient`**: simulierter Erfolg (keine echte Phishing-Check-Logik
  im Mock, analog zum Web-Mock-Server), liefert eine erfundene
  `sentMessageId`.
- **`RemoteAPIClient`**: eigene Implementierung statt der generischen
  `post()`-Hilfsfunktion, weil `422` explizit am HTTP-Status erkannt und
  als `.blocked` geworfen werden muss (die übrigen Endpunkte prüfen den
  Status bisher gar nicht — hier ist das nötig, weil der Blockier-Fall kein
  Fehler im Sinne von "Request kaputt" ist, sondern ein gültiges
  Geschäftsergebnis). Wie die übrigen `RemoteAPIClient`-Pfade ungetestet
  gegen einen echten Server (kein Live-Backend in dieser Umgebung).
- **UI** (`Views/MessageDetailView.swift`): der Entwurfstext ist jetzt in
  einem `TextEditor` editierbar (statt nur `Text`, der Nutzer kann den
  KI-generierten Vorschlag vor dem Versand anpassen), darunter ein echter
  "Senden"-Button. Bei `.blocked` erscheint der `reason` direkt unter dem
  Entwurf, bei Erfolg eine Bestätigung ("Antwort an … wurde gesendet.") und
  die Entwurfskarte verschwindet.
- **Nicht umgesetzt** (bewusst, siehe WEB_INBOX.md-Reihenfolge): kein
  "Neue Mail verfassen"-Screen, keine Anhänge (siehe Nachtrag direkt
  unten), kein lokaler Eintrag im "Gesendet"-Ordner (der Ordner selbst
  existiert noch nicht — hängt laut Web explizit von diesem Endpunkt ab,
  nicht umgekehrt).

## [2026-09-10] Nachtrag: Anhänge (`POST /attachments`)

Contract-Nachtrag "Erweiterung des Send-Endpunkt-Eintrags von eben"
(WEB_INBOX.md 09.09.): Anhänge müssen vor dem Versand hochgeladen und
gescannt werden, `POST /messages/send` lehnt ab, wenn eine mitgegebene
`attachmentId` nicht `scanStatus == .clean` hat.

- **Modelle** (`Models/Attachment.swift`, neu): `AttachmentScanStatus`
  (`pending`/`clean`/`malicious`/`blocked_type`/`scan_failed`) +
  `AttachmentUploadResult` (`attachmentId`/`scanStatus`), 1:1 aus
  `POST /attachments` in api-spec.yaml.
- **`APIClient`**: `sendMessage(...)` bekommt einen neuen Parameter
  `attachmentIds: [String]` (Pflichtparameter, kein Default — alle drei
  Implementierungen + der Aufruf in `MessageDetailView` mussten
  entsprechend angepasst werden). Neue Methode
  `uploadAttachment(filename:mimeType:data:) async throws -> AttachmentUploadResult`.
- **`MockAPIClient`**: eigenes In-Memory-Dictionary
  (`uploadedAttachments: [String: AttachmentScanStatus]`, kein
  MockDatabase.json-Pendant nötig, da Anhänge nie vorab geseedet sind,
  sondern immer erst zur Laufzeit hochgeladen werden) + dieselbe simple
  Dateiendungs-Heuristik wie der echte Scan-Mock im Backend
  (`attachmentScanMock.ts`), dupliziert statt geteilt (unterschiedliche
  Sprachen). `sendMessage` prüft das Anhang-Gate echt (nicht nur simuliert)
  gegen dieses Dictionary.
- **`RemoteAPIClient`**: `uploadAttachment` baut das `multipart/form-data`-
  Grundgerüst von Hand (Boundary, `Content-Disposition`-Header) — kein
  `post()`-Helper, der setzt immer `Content-Type: application/json`.
- **UI** (`Views/MessageDetailView.swift`): neuer "Anhang hinzufügen"-
  Button öffnet `.fileImporter` (`allowsMultipleSelection: true`, jede
  ausgewählte Datei löst sofort einen eigenen Upload-Task aus, parallel,
  nicht nacheinander). Pro Datei ein `ComposeAttachment`-Eintrag mit
  Dateiname + Status-Badge (Spinner-Text während des Uploads, danach
  "Geprüft" grün bzw. der jeweilige Blockier-Grund rot) + Entfernen-Button
  (`xmark.circle.fill`). "Senden" bleibt deaktiviert, solange
  `hasBlockingAttachment` true ist (irgendein Anhang nicht `.clean`).
  Security-Scoped-Resource-Zugriff (`startAccessingSecurityScopedResource`)
  beim Lesen der vom `.fileImporter` gelieferten URL, wie bei iOS-Datei-
  Picks aus anderen Apps/iCloud Drive üblich.
- **Xcode-Projekt:** `Models/Attachment.swift` musste manuell in
  `project.pbxproj` registriert werden (`PBXBuildFile`/`PBXFileReference`
  + Aufnahme in die `Models`-Gruppe und die `Sources`-Build-Phase) — das
  `.xcodeproj` ist generiert, keine automatische Dateisystem-Synchronisation
  (siehe "Öffnen in Xcode" unten), ein einfaches `Write` einer neuen
  `.swift`-Datei reicht hier nicht.
- **Bewusst nicht Teil dieses Schritts** (gleiche Grenze wie im Backend,
  siehe backend/README.md "Anhänge"): der Dateiinhalt wird zwar zum
  Backend hochgeladen, aber dort nicht gespeichert (kein Objektspeicher) —
  ein tatsächlich versendeter Anhang wird deshalb aktuell nicht in die
  ausgehende Mail eingebettet, nur der Scan-Gate-Mechanismus selbst ist
  fertig.

**Tests:** `xcodebuild ... -destination 'generic/platform=iOS Simulator' build`
sowie zusätzlich `-destination 'platform=iOS Simulator,name=iPhone 17' build`
**BUILD SUCCEEDED**, App installiert/gestartet, Screenshot verifiziert
(Ordnerliste rendert weiterhin korrekt). Kein interaktiver Klick-Test des
neuen Anhang-Flows (Datei auswählen -> Scan-Status -> Senden blockiert/
freigegeben) möglich, da in dieser Umgebung kein UI-Automation-Werkzeug für
den iOS-Simulator zur Verfügung stand — ehrlich so dokumentiert statt als
vollständig getestet behauptet (anders als der Web-Client, dort lief der
komplette Flow inkl. Datei-Upload per Browser-Automation durch).

## [2026-09-10] Nachtrag: Ordner-Umbau + Entwürfe (Schritt 3)

Contract-Nachtrag "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"
(WEB_INBOX.md 09.09.): Standard-Ordner-Liste geändert.

- **`Models/Folder.swift`:** `SystemFolderKey` auf die neue 7er-Liste
  geändert (`eingang`/`entwuerfe`/`gesendet`/`sonstiges`/`quarantaene`/
  `spam`/`papierkorb`, `wichtig`/`rechnungen` entfallen). Neue
  `isDrafts`-Computed-Property (analog `isTrash`) markiert den
  "entwuerfe"-Ordner. `isRenamable` um `entwuerfe`/`gesendet` ergänzt.
- **`DesignSystem/DesignTokens.swift`:** `SystemFolders.defaults` auf die
  neue Liste + Icons (`file-pencil` Entwürfe, `send` Gesendet, `folder`
  Sonstiges statt `inbox`, das jetzt Eingang gehört) aktualisiert.
- **`Networking/MockData/MockDatabase.json`:** `folder-wichtig` →
  `folder-eingang` (gleiche Nachrichten, neuer `systemKey`),
  `folder-rechnungen` bleibt unter derselben `id` bestehen, aber als
  normaler benutzerdefinierter Ordner (`isSystem: false`,
  `systemKey: null`) — analog zur Migration, die das echte Backend zur
  Laufzeit macht (`migrateLegacySystemFolders()`, `backend/src/db/store.ts`),
  hier einmalig direkt in den Testdaten nachvollzogen. Neue leere
  `folder-entwuerfe`/`folder-gesendet`-Einträge.
- **`Models/Draft.swift`** (neu, `PBXBuildFile`/`PBXFileReference`
  manuell registriert wie bei `Attachment.swift`): mirrors
  `components/schemas/Draft`.
- **`APIClient`:** `sendMessage(...)` bekommt einen neuen Parameter
  `draftId: String?` (bei Erfolg verwirft der Server den Entwurf
  automatisch, falls gesetzt — bestehender Aufruf in `MessageDetailView`
  übergibt `nil`, da diese App keinen "aus Entwurf gestartet"-Zustand
  kennt). Neue Methoden `fetchDrafts()`/`deleteDraft(id:)` — bewusst KEIN
  `createDraft`/`updateDraft` in diesem Client (anders als `web/src/api.ts`,
  das beide für einen künftigen Compose-Screen vorhält): ohne jeden
  Aufrufer hätte die Pflicht-Protokollmethode nur totes Gerüst in
  `MockAPIClient`/`RemoteAPIClient` erzeugt.
- **`Views/DraftListView.swift`** (neu): zeigt den "entwuerfe"-Ordner via
  `GET /drafts`, NICHT `fetchMessages(...)`. Bewusst nur Liste (Empfänger/
  Betreff/Vorschau) + Swipe-to-Delete, kein Bearbeiten — ein Entwurfs-Editor
  bräuchte einen eigenen Compose-Screen ("neue Mail verfassen"), der auch
  nach diesem Schritt nicht Teil der App ist. `MockAPIClient` liefert dafür
  einen einzelnen fest verdrahteten Beispiel-Entwurf (kein
  `MockDatabase.json`-Pendant, da nie vorab geseedet, siehe Code-Kommentar),
  damit die Ansicht beim ersten Start etwas zeigt statt dauerhaft leer zu
  sein.
- **`Views/FolderListView.swift`:** `navigationDestination` routet
  `folder.isDrafts` auf `DraftListView` statt `InboxListView`. Der
  Sidebar-Zähler holt sich für den Entwürfe-Ordner zusätzlich
  `fetchDrafts().count` (der normale `GET /messages`-Zähler wäre für
  diesen Ordner sonst immer 0).
- **`MockAPIClient.sendMessage(...)`** legt nach einem erfolgreichen
  Versand zusätzlich eine lokale `MessageDetail` im "gesendet"-Ordner an
  (analog zum echten Backend) und entfernt den referenzierten Entwurf,
  falls `draftId` gesetzt war.
- **Bekannte, bewusst nicht behobene Grenze:** anders als im Web-Client
  (dort per `onSent`-Callback gefixt, siehe `web/README.md` "Ordner-Umbau")
  aktualisiert sich der "Gesendet"-Zähler in `FolderListView` NICHT
  automatisch, wenn der User nach einem Versand von `MessageDetailView`
  zur Ordnerliste zurücknavigiert — `FolderListView` bleibt als
  `NavigationStack`-Root im Hintergrund bestehen, ihr `.task` feuert beim
  Zurücknavigieren nicht erneut. Der bestehende Pull-to-refresh
  (`.refreshable { loadFoldersAndCounts(forceRefresh: true) }`) ist der
  Workaround. Eine echte Lösung bräuchte geteilten State (z.B. Zähler in
  `AppEnvironment` statt lokal in `FolderListView`) — außerhalb des
  Aufwands, der für diesen Schritt angemessen war, hier bewusst
  dokumentiert statt stillschweigend liegen gelassen.

**Tests:** `xcodebuild` gegen beide Simulator-Ziele **BUILD SUCCEEDED**,
App installiert/gestartet, Screenshot verifiziert (alle 9 Ordner in
korrekter Reihenfolge mit korrekten Icons/Zählern, insbesondere
"Entwürfe: 1" und "Rechnungen" jetzt ohne Badge-Sonderbehandlung als
normaler Ordner). Kein interaktiver Klick-Test der `DraftListView` selbst
(Öffnen/Löschen eines Entwurfs) — gleiche Werkzeug-Grenze wie bei den
vorherigen Nachträgen.

## [2026-09-10] Nachtrag: Antworten-Button bei Spam (Schritt 4)

Contract-Nachtrag "KORREKTUR der letzten Regel" (WEB_INBOX.md 09.09.):
der "Antwortentwurf"-Button in `Views/MessageDetailView.swift`
(`actions(for:)`) wird jetzt ausgeblendet, wenn `currentFolder?.systemKey
== .spam` — vorher gab es diese Einschränkung noch gar nicht (die
ursprüngliche `classification`-basierte Regel aus WEB_INBOX.md war nie
implementiert worden, nur spezifiziert). Gleiche Ordner-basierte Logik wie
bereits bei `currentFolder?.systemKey == .quarantaene` (Warnbanner) und
`.papierkorb` (Löschen-Button-Variante) — der Ordner-Check ist in dieser
View bereits das etablierte Muster, keine neue Abstraktion nötig. Bei
Quarantäne (Phishing) bleibt der Button bewusst sichtbar (Warnbanner wie
bisher), da der User eine Phishing-Mail trotzdem sehen/melden können soll.

**Kleiner Nachzügler gleich mit erledigt:** das Label "Was wollen die von
mir?" hieß in iOS noch nicht "Inhalt" — die Umbenennung aus Schritt 3 war
für iOS übersehen worden (nur Web hatte sie bekommen). Jetzt nachgezogen,
gleiche Stelle.

Kein Backend-/Contract-Change nötig (`Folder.systemKey` existierte
bereits) — reine UI-Bedingung, wie in WEB_INBOX.md spezifiziert.

**Tests:** `xcodebuild -destination 'generic/platform=iOS Simulator' build`
**BUILD SUCCEEDED**. Kein interaktiver Klicktest (gleiche Werkzeug-Grenze
wie bei den vorherigen Nachträgen) — die Web-Variante derselben Logik
wurde im Browser end-to-end verifiziert (siehe `web/README.md`
"Antworten-Button bei Spam"), die iOS-Implementierung folgt exakt demselben
`folderId`/`systemKey`-Vergleichsprinzip gegen dasselbe API-Feld.

## [2026-09-10] Nachtrag: Automatische Abmeldung bei Spam (Schritt 5)

`Models/Message.swift`: `MessageDetail.canUnsubscribe: Bool` neu (spiegelt
das gleichnamige, kleine Contract-Feld — steuert, ob die Nachricht einen
gültigen List-Unsubscribe-Header hat, unabhängig von `classification`).
`Models/Classification.swift`: neues `UnsubscribeStatus`-Enum
(`pendingConfirmation`/`confirmed`/`rejected`, spiegelt
`unsubscribe_actions.status`). `APIClient`-Protokoll +
`MockAPIClient`/`RemoteAPIClient`: neue Methode
`unsubscribeFromMessage(id:) async throws -> UnsubscribeStatus` (`POST
/messages/{messageId}/unsubscribe`). `Views/MessageDetailView.swift`: neuer
"Von Absender abmelden"-Button (nur sichtbar bei `canUnsubscribe == true`,
unabhängig vom aktuellen Ordner/der Klassifikation — auch bei Phishing
manuell möglich, siehe `backend/README.md` "Automatische Abmeldung bei
Spam"), ersetzt sich nach Erfolg durch einen Status-Text statt erneut
klickbar zu bleiben.

`MockDatabase.json`: `canUnsubscribe` für alle 13 Beispiel-Nachrichten
ergänzt (Codable-Pflichtfeld, keine sinnvolle Default-Annahme möglich) —
`true` für beide Spam-Beispiele plus eine Marketing-Newsletter- und eine
Papierkorb-Beispielnachricht (zeigt den Button unabhängig von Ordner/
Klassifikation), sonst `false`.

**Tests:** `xcodebuild` gegen zwei Simulator-Ziele **BUILD SUCCEEDED**. Kein
interaktiver Klicktest (gleiche Werkzeug-Grenze wie bei den vorherigen
Nachträgen) — die Web-Variante derselben Logik wurde im Browser
end-to-end verifiziert (siehe `web/README.md`).

## [2026-09-10] Nachtrag: echte Auth (kein iOS-Code-Change nötig)

Backend-seitig verlangt jede Contract-Route jetzt einen gültigen
`Authorization: Bearer <token>`-Header (siehe `backend/README.md` "Auth").
Für iOS ändert sich dadurch **nichts**: `AppEnvironment` nutzt weiterhin
ausschließlich `MockAPIClient` (spricht nie das Netzwerk an, siehe unten
"Was ist gemockt"), `RemoteAPIClient` ist unverändert ein unverdrahtetes
Skeleton (`APIError.notImplemented` an mehreren Stellen, nie gegen einen
echten Server getestet — siehe "Was ungetestet ist"). Sobald `RemoteAPIClient`
tatsächlich verdrahtet wird, braucht es dort einen Session-Bootstrap
analog zu `web/src/api.ts` (`ensureSessionToken()`, implizites `POST
/accounts` beim ersten Request) — bewusst nicht vorgezogen, um kein totes,
ungetestetes Code sitzenzulassen, solange `RemoteAPIClient` ohnehin nicht
genutzt wird.

## [2026-09-10] Nachtrag: Antworten ohne KI-Zwang (WEB_INBOX.md-Priorität, gleiche Woche wie echte Auth)

Gleicher Fund/Fix wie in `web/README.md` (siehe dort für die identische
Web-Änderung, `MessageDetailPane.tsx`): der "Antwortentwurf"-Button rief
bisher direkt `requestReplyDraft()` (KI-Aufruf, `POST
/messages/{id}/reply-draft`) auf, und **nur** ein Erfolg davon setzte
`draft: String?` auf einen Wert ungleich `nil` — das war zugleich die
einzige Bedingung, unter der das Compose-Feld überhaupt sichtbar wurde. Ein
Antworten ohne KI war UI-seitig gar nicht möglich, obwohl das Backend das
nie verlangt hat (`bodyText` in `POST /messages/send` ist ein normales,
vom User editierbares Textfeld).

**Fix in `Views/MessageDetailView.swift`:** `draft: String?` ersetzt durch
zwei getrennte States, `isReplyOpen: Bool` (steuert allein die Sichtbarkeit
von `replyCard`, vorher `draftCard`) und `replyBody: String` (von Anfang an
`""`, sofort editierbar). Der bisherige "Antwortentwurf"-Button heißt jetzt
"Antworten" und öffnet nur noch `isReplyOpen = true` — kein Netzwerk-Call.
Innerhalb der offenen `replyCard` gibt es jetzt zwei zusätzliche Buttons:
"KI-Entwurf" (optional, ruft `requestAiDraft()` — umbenannt aus `loadDraft()`
— auf und füllt `replyBody`; fragt per `confirmationDialog` erst nach, wenn
bereits eigener Text im Feld steht, damit ein versehentlicher Tap nichts
stillschweigend verwirft) und "Verwerfen" (schließt das Feld wieder,
`isReplyOpen = false`, `replyBody = ""` — vorher gab es keinen Weg zurück,
sobald ein Entwurf geladen war, außer Senden).

Gleiche Sichtbarkeitsregel wie vorher unverändert übernommen: kein
"Antworten"-Button im `spam`-Systemordner (`currentFolder?.systemKey !=
.spam`, siehe Nachtrag "Antworten-Button bei Spam" oben).

**Tests:** `xcodebuild -destination 'platform=iOS Simulator,name=iPhone 17'
build` **BUILD SUCCEEDED**. Kein interaktiver Klicktest (gleiche
Werkzeug-Grenze wie bei den vorherigen Nachträgen) — die Web-Variante
derselben Logik wurde im Browser end-to-end verifiziert (leeres
Compose-Feld sofort nutzbar, "KI-Entwurf vorschlagen" füllt es optional,
"Verwerfen" schließt es wieder), die iOS-Implementierung folgt exakt
demselben State-Aufteilungsprinzip.

## [2026-09-15] Nachtrag: Ordner-Namensvorschlag + Header zeigt Konto-Adresse (Optik-Punkte 1+2 der FREIGABE-Liste)

**Ordnername-Vorschlag "Dokumente"** (WEB_INBOX.md 10.09. "kleine
UX-Ergänzung"): `Views/FolderListView.swift` fragt den Ordnernamen über ein
natives SwiftUI `.alert()` mit `TextField` ab — anders als die
Web-Sidebar kann ein `.alert()` keine eigene Chip-/Quick-Pick-Reihe
hosten (Plattform-Grenze, kein Custom-Sheet nur für diese eine
Polish-Aufgabe gebaut, wäre unverhältnismäßig zum Umfang). Stattdessen der
`TextField`-Placeholder von "Name" auf "z. B. Dokumente" geändert — gleiche
Absicht (Vorschlag statt leerem Feld), plattformgerecht umgesetzt statt
1:1 portiert.

**Header zeigt Konto-Adresse statt "driftmail"** (WEB_INBOX.md 10.09.
"UX-Fund im echten Geräte-Test"): neues `AppEnvironment.account:
MailAccount?` + `loadAccount()` (gleiches Cache-Muster wie `loadFolders()`,
nutzt den bereits im `APIClient`-Protokoll vorhandenen `fetchAccounts()`).
`FolderListView.swift` ruft `loadAccount()` im `.task` auf und setzt
`.navigationTitle(environment.account?.emailAddress ?? "driftmail")` —
**Ersetzen statt Ergänzen**, anders als die Web-Sidebar (die Branding
UND Adresse gleichzeitig zeigen kann, weil beides eigene Zeilen sind):
ein `navigationTitle` ist ein einzelner String, "statt" war laut Auftrag
("statt ODER zusätzlich") gleichwertig zulässig und ist der native
iOS-Weg für einen einzeiligen Titel. Fällt auf "driftmail" zurück, solange
das Konto noch lädt oder bei einem Fehler (`loadAccount()` lässt `account`
dann bewusst `nil`, kein erzwungener Ladezustand). Kein
Account-Switcher (laut Auftrag kein Muss für diesen Schritt, `account` ist
aber bereits zentral in `AppEnvironment` gehalten, falls das später
gebraucht wird).

**Web-Seite bereits erfüllt, verifiziert statt neu gebaut:** die
Web-Sidebar (`FolderSidebar.tsx`) zeigt die Konto-Adresse (`account?.
emailAddress` aus einem echten `listAccounts()`-Aufruf, kein Mock-Wert)
bereits seit dem allerersten Track-F-Skeleton unterhalb des
"driftmail"-Brandings — das erfüllt bereits die "zusätzlich
zum App-Namen"-Variante aus dem Auftrag, keine Web-Änderung für diesen
Punkt nötig. Per Git-Historie nachvollzogen (nicht nur behauptet): der
Code existierte schon vor diesem WEB_INBOX.md-Eintrag.

**Tests:** `xcodebuild -sdk iphonesimulator build` **BUILD SUCCEEDED**.
Kein Simulator-Device-Boot in dieser Umgebung möglich (CoreSimulator-
Framework auf diesem Mac veraltet gegenüber der installierten
Xcode-Version, siehe Fehlermeldung bei `xcodebuild -list` — ein
System-/Xcode-Update-Thema, kein Code-Problem; Build gegen das
iphonesimulator-SDK selbst lief beide Male durch), kein interaktiver
Klicktest. Web-Seite (nur Ordnername-Vorschlag, Header war schon da) per
Browser-Automation end-to-end verifiziert, siehe `web/README.md`/
SYNC.md.

## [2026-09-19] Nachtrag: App-Sperre per Face ID/Touch ID (Punkt 5 von "6 Sicherheits-Ergänzungen")

WEB_INBOX.md 15.09.: App selbst zusätzlich zum Mail-Konto-Login mit
biometrischer Sperre schützen, optional (nicht erzwungen), empfohlen beim
Onboarding.

**Neu (`Security/BiometricLock.swift`, `Views/AppLockGateView.swift`):**
- `BiometricLock`: dünner `LocalAuthentication`/`LAContext`-Wrapper.
  `availableKind()` liefert Face ID/Touch ID/nur-Geräte-Code/nicht
  verfügbar (steuert Icon+Text, ohne "Face ID" fest zu verdrahten).
- **Design-Entscheidung (nicht explizit im Auftrag):**
  `.deviceOwnerAuthentication` statt
  `.deviceOwnerAuthenticationWithBiometrics` -- fällt bei fehlgeschlagener/
  nicht eingerichteter Biometrie auf den Geräte-Code zurück statt den User
  komplett auszusperren (z.B. Maske/Verletzung). Schützt trotzdem genau den
  im Auftrag genannten Fall ("Gerät verloren/gestohlen, App noch
  eingeloggt") -- wer weder Gesicht/Finger noch Geräte-Code kennt, kommt so
  oder so nicht rein, exakt das Schutzniveau des iOS-Sperrbildschirms
  selbst, zusätzlich auf driftmail angewendet. Ausführlich begründet im
  Code-Kommentar.
- `AppLockGateView<Content>`: sperrt den kompletten App-Inhalt, re-sperrt
  bei jedem Verlassen des Vordergrunds (`scenePhase`-Beobachtung, nicht nur
  beim Neustart -- eine kurze App-Wechsler-Vorschau reicht sonst nicht als
  Schutzmoment). In `RootView.swift` um `FolderListView()` gelegt.
- `AppLockToggleView`: ein Toggle, wiederverwendet im neuen zweiten
  Onboarding-Schritt (`RootView.swift`, `OnboardingAppLockStepView`, direkt
  nach dem Capability-Check) UND im neuen, ersten Settings-Sheet des
  Scaffolds (`FolderListView.swift`, Zahnrad-Icon im Toolbar -- es gab
  bisher gar keine Settings-Fläche). Beide lesen/schreiben denselben
  `@AppStorage("appLockEnabled")`-Key, bleiben also garantiert synchron.
- `Info.plist`: `NSFaceIDUsageDescription` ergänzt (`project.pbxproj`
  `INFOPLIST_KEY_NSFaceIDUsageDescription`, Info.plist wird generiert, es
  gibt keine physische Datei) -- ohne diesen String lehnt iOS
  `LAContext.evaluatePolicy` mit Face ID kommentarlos ab.

**Bewusst NICHT server-seitig/synchronisiert:** biometrische Registrierung
ist geräte-gebunden, anders als die bereits im Contract vorhandenen
Account-MFA-Einstellungen (`user_security_settings` in
`contracts/db-schema.sql`, TOTP/SMS/Passkey beim Login) -- kein
Contract-/Backend-Change für dieses Feature.

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'platform=iOS
Simulator,name=iPhone 17 Pro' build` **BUILD SUCCEEDED**. Anders als beim
09-15-Nachtrag oben war diesmal ein echter Simulator-Boot möglich
(CoreSimulator hat sich beim ersten `simctl`-Aufruf selbst aktualisiert) --
App installiert, gestartet, per Screenshot verifiziert, dass der
bestehende Capability-Check-Screen weiterhin unverändert rendert (keine
Regression durch die `RootView.swift`-Umbauten). Der neue zweite
Onboarding-Schritt sowie das Settings-Sheet sind NICHT per Screenshot
verifiziert -- Tap-Interaktionen sind in dieser Umgebung weiterhin nicht
automatisierbar (kein `idb`, kein Zugriff auf die Simulator.app-UI per
Accessibility, siehe frühere iOS-Einträge in SYNC.md mit derselben
Einschränkung). Ein echter Face-ID-Match-Test bräuchte ohnehin entweder ein
physisches Gerät oder eine manuell im Simulator eingerichtete Enrolled-
Biometrie (`Features > Face ID > Enrolled`), beides nicht headless
möglich.

## [2026-09-19] Geprüft, nicht gebaut: Verschlüsselung der lokalen Mail-Datenbank (Punkt 6 von "6 Sicherheits-Ergänzungen")

WEB_INBOX.md 15.09. ging davon aus, dass es bereits einen lokalen Mail-
Cache gibt ("siehe frühere Diskussion zu lokalem IMAP-Cache"). **Verifiziert
(nicht nur behauptet):** es gibt aktuell KEINE lokale Mail-Datenbank auf
iOS. Der aktive Client ist `MockAPIClient` (In-Memory-Mockdaten,
`AppEnvironment.swift`), `RemoteAPIClient` ist laut eigenem Kopfkommentar
ein "SKELETON, not wired up yet" ohne jede Persistenz. Nachrichten würden,
sobald `RemoteAPIClient` aktiv ist, bei jedem Laden live vom Backend
geholt -- keine `CoreData`/`SQLite`/Datei-Cache im gesamten `ios/`-Baum
(per Volltextsuche verifiziert). Es gibt also aktuell nichts, das eine
Verschlüsselung sinnvoll abdecken könnte, ohne selbst erst eine komplette
lokale Persistenzschicht zu erfinden -- das wäre eine eigene, große
Architektur-Entscheidung (Cache ja/nein, welcher Umfang, welche
Invalidierung), keine kleine Ergänzung, und nicht Teil dieses Auftrags.

**Einordnung, warum das hier trotzdem kein Rückschritt ist:** genau das
Risiko, das dieser Punkt adressieren sollte ("Gerät verloren/gestohlen,
Mails lesbar"), wird für den aktuellen Stand bereits durch Punkt 5
(App-Sperre, siehe oben) abgedeckt -- da nichts lokal gespeichert ist, gibt
es keine ungeschützt auf der Platte liegenden Mails, die eine separate
Verschlüsselung zusätzlich bräuchte; der Zugriffsschutz sitzt vor dem
Live-Abruf.

**Einzige tatsächlich lokal persistierte, sensible Größe aktuell: keine auf
iOS** (kein Token-Storage vorhanden, siehe `RemoteAPIClient.swift`-
Kommentar), **aber der Session-Token im Web-Client** (`localStorage`,
`web/src/api.ts`). Dort ehrlich dokumentiert statt stillschweigend
übergangen: `localStorage` ist grundsätzlich nicht at-rest-verschlüsselt
und lässt sich das per Browser-JS nicht sinnvoll nachrüsten (ein per
SubtleCrypto verschlüsselter Wert bräuchte einen Schlüssel, der demselben
Origin-JS zugänglich sein müsste -- gewinnt nichts gegen die eigentliche
Bedrohung, XSS im selben Origin). Für `RemoteAPIClient.swift` als
Vormerkung hinterlegt: sobald dort Token-Persistenz dazukommt, gehört sie
in die Keychain, nicht in `UserDefaults`.

**Kein Code-Change für diesen Punkt** -- eine vorgetäuschte
Verschlüsselung einer nicht existierenden Datenbank wäre irreführend
gewesen. Massimo/Web müssten zuerst entscheiden, ob/wann ein echter lokaler
Mail-Cache überhaupt gebaut werden soll (eigenes, größeres Thema), bevor
"verschlüssele ihn" sinnvoll umsetzbar ist.

## [2026-09-21] Nachtrag: Onboarding-Provider-Auswahl + Sicherheits-Badges + echte Account-Verbindung (WEB_INBOX.md 19.09., "voll verdrahten" per Rückfrage an Massimo, 21.09.)

Zwei UI-Punkte aus dem 19.09.-Auftrag, plus (auf Massimos ausdrücklichen
Wunsch, siehe Rückfrage) eine echte Session-Architektur, die es auf iOS
bisher gar nicht gab.

**1) Onboarding: Provider-Auswahl + IMAP-Formular.** Neuer erster
Onboarding-Schritt `Views/OnboardingAccountConnectView.swift`, läuft in
`RootView.swift` VOR allem anderen (auch vor dem bestehenden Capability-
Check) -- gated über `AppEnvironment.isAuthenticated`. Karten-Liste aus
`GET /mail-providers` (Fallback: `MailProvider.mocked`, hand-gepflegter
Swift-Mirror von `contracts/mail-providers.json`, gleiches Prinzip wie
`DesignTokens.swift`). Gmail ist gelistet, aber **bewusst nicht
klickbar-funktional** -- siehe Grenze weiter unten. iCloud/GMX/web.de/
generisches IMAP öffnen ein Formular (vorbefüllt aus dem Provider-Preset,
Servereinstellungen für den Normalfall eingeklappt), das `POST /accounts`
(`provider=imap`) aufruft.

**2) Sicherheits-Badges.** `Models/Message.swift`: `SecurityResult` +3
Felder (`displayNameSpoofingDetected`/`replyToMismatchDetected`/
`ibanChangedInThread`), `MessageDetail` +1 Feld (`isNewSender`) -- beide
waren im Contract/Backend bereits seit den Sicherheits-Ergänzungen vom
15.09. vorhanden, auf iOS bisher nicht gespiegelt (analog zum Web-Client
vor demselben Fix). `Views/MessageDetailView.swift`s private
`SecurityBadgesView` bekommt vier neue Pills, in derselben `badge()`/
`flag()`-Optik wie die bestehenden SPF/DKIM/Homoglyph-Anzeigen -- "Neuer
Absender" nutzt `DesignTokens.Color.warning` statt `.danger` (bisher
ungenutzter Token), da es kein Angriffssignal, sondern ein Kontext-Hinweis
ist. `isNewSender` wird vor der Anzeige mit `GET /trusted-senders`
abgeglichen (`AppEnvironment.loadTrustedSenders()`), exakt wie in
`api-spec.yaml` beschrieben.

**3) "Voll verdrahtet" statt UI-only (Rückfrage-Ergebnis, siehe SYNC.md):**
iOS lief bis hierhin ausschließlich gegen `MockAPIClient` --
`RemoteAPIClient` war ein unbenutztes Skeleton, es gab keine
Token-Persistenz, keinen "eingeloggt"-Zustand. Statt die neue
Onboarding-UI nur gegen Mock zu verdrahten (hohl, ohne Wirkung auf den
Rest der App), wurde die Session-Architektur jetzt echt gebaut:
- `Security/SessionStore.swift`: Keychain-Wrapper (`kSecClassGenericPassword`)
  für den Session-Token -- wie im `RemoteAPIClient`-Kopfkommentar seit dem
  15.09.-Punkt-6-Nachtrag vorgemerkt.
- `AppEnvironment.apiClient` ist jetzt `@Published private(set) var` statt
  `let`: startet als `MockAPIClient`, oder direkt als token-tragender
  `RemoteAPIClient`, falls die Keychain beim Start schon einen Token hat.
  `completeAccountConnection(account:token:)` schaltet nach erfolgreicher
  Verbindung für den Rest der App-Session auf `RemoteAPIClient` um --
  nichts unterhalb von `AppEnvironment` musste angefasst werden, das war
  genau der Sinn des `APIClient`-Protokolls von Anfang an.
- `RemoteAPIClient`: war Skeleton, ist jetzt der echte, aktiv genutzte
  Pfad. Ergänzt: `Authorization: Bearer <token>`-Header auf JEDEM Request
  (fehlte komplett), konfigurierbare Base-URL per
  `DRIFTMAIL_API_BASE_URL`-Env-Var (Xcode-Scheme, Default bleibt
  `https://api.driftware.online/v1` aus dem Contract) für lokale
  Entwicklung gegen `backend/` (analog `web/`s `VITE_API_BASE_URL`).
- `Info.plist`: von `GENERATE_INFOPLIST_FILE` auf eine echte, eingecheckte
  Datei umgestellt (die `INFOPLIST_FILE_ADDITIONAL_CONTENT`-Build-Setting
  für die nötige `NSAllowsLocalNetworking`-ATS-Ausnahme wurde beim Bauen
  verifiziert NICHT angewendet -- stiller Fehler, erst durch Vergleich des
  tatsächlich generierten `Info.plist`-Inhalts per `plutil -p` entdeckt).
  **Wichtig für zukünftige Änderungen:** alle Standard-Pflichtschlüssel
  (`CFBundleExecutable` etc.) müssen jetzt explizit im `Info.plist` stehen
  (per `$(VARIABLE)`-Substitution) -- die werden bei einer statischen
  Datei NICHT mehr automatisch injiziert, anders als bei
  `GENERATE_INFOPLIST_FILE=YES`. Ohne diese Korrektur wäre die App
  installierbar, aber nicht startfähig gewesen (fehlendes
  `CFBundleExecutable`) -- per `simctl install`+`simctl launch` auf einem
  echten Simulator verifiziert, nicht nur `BUILD SUCCEEDED` vertraut.
- `Views/FolderListView.swift`s `SettingsView`: neuer "Konto trennen"-
  Button (mit Bestätigungsdialog) -- ohne den wäre ein falsch verbundenes
  Konto mit einem echten Login-Gate nicht mehr korrigierbar gewesen ohne
  App-Neuinstallation.

**Bewusste Grenze: Gmail-OAuth auf iOS nicht funktional.** `GET
/auth/google/start` ist ein Browser-Redirect-Flow; der native iOS-Weg dafür
wäre `ASWebAuthenticationSession`. Das scheitert aber an einer echten
Backend-Grenze: `GET /auth/google/callback` redirected nach Erfolg fest zu
`FRONTEND_URL` (eine einzelne, global konfigurierte Web-Origin) --
`ASWebAuthenticationSession` braucht einen Redirect zu einem
Custom-URL-Scheme, das der Server nicht kennt. Ohne eine
Backend-Erweiterung (z.B. `redirect_uri`/`platform`-Query-Param auf `/auth/
google/start`, der den finalen Redirect-Ziel-Wert bestimmt statt des
fest verdrahteten `FRONTEND_URL`) ist das serverseitig gar nicht
lösbar -- kein iOS-Client-Problem. Deshalb: Gmail ist in der Liste
sichtbar, aber ein Tap zeigt eine ehrliche Erklärung statt einen kaputten
Flow zu starten oder eine Fake-Anmeldung vorzutäuschen. Als offene Frage
an Track A in SYNC.md vermerkt.

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'generic/platform=iOS
Simulator' build` **BUILD SUCCEEDED**. Diesmal zusätzlich per `simctl
install`+`simctl launch` auf einem echten Simulator (iPhone 17 Pro)
verifiziert, nicht nur gebaut -- Provider-Auswahlbildschirm per Screenshot
bestätigt (alle 7 Provider korrekt gelistet, Gmail/Outlook/Yahoo optisch
als eingeschränkt erkennbar). Gegen den echten lokalen `backend/`
(`DRIFTMAIL_API_BASE_URL=http://localhost:3000/v1` über
`SIMCTL_CHILD_`-Env-Var) blieb `GET /mail-providers` beim Laden auf die
Fallback-Liste zurückfallen, obwohl derselbe Endpunkt gegen denselben
Backend-Prozess per `curl` UND aus dem Web-Client (siehe `web/README.md`)
nachweislich funktioniert -- vermutlich eine Simulator-/Xcode-27-
spezifische Netzwerk-Eigenheit dieser Umgebung, nicht als Code-Fehler
verifizierbar in der verfügbaren Zeit (kein `curl` im Simulator-Sandbox
verfügbar für eine direkte Gegenprobe, `simctl spawn` scheiterte daran).
**Offen für eine spätere Sitzung mit echtem Xcode-Zugriff:** den
Fallback-Pfad selbst (Mock-Daten, Providerliste, IMAP-Formular-UI,
Sicherheits-Badges) hat ein echter Simulator-Lauf bestätigt -- nur der
Weg über `RemoteAPIClient` gegen `localhost` in DIESER Simulator-Instanz
nicht. Kein Blocker für den Code selbst (identisches Muster wie die
bereits funktionierenden `get()`/`post()`-Aufrufe für alle anderen
Endpunkte), aber nicht abschließend verifiziert.

**Übergabe:** Track F (Web) hat denselben Auftrag bereits umgesetzt
(siehe `web/README.md`). Massimo müsste den echten IMAP-Verbindungsweg auf
iOS einmal mit einem echten Konto gegentesten, sobald die
`RemoteAPIClient`-Netzwerk-Eigenheit oben geklärt ist.

## [2026-09-21] Nachtrag: Pull-to-Refresh löst echten Mail-Abruf aus (WEB_INBOX.md 21.09., "SEHR WICHTIGE LUECKE - HOECHSTE PRIORITAET")

`FolderListView.swift`s bereits vorhandenes `.refreshable` rief bisher nur
`environment.loadFolders(forceRefresh:)` auf -- lädt also nur den bereits
im Backend vorhandenen Stand neu, löst aber keinen neuen Mail-Abruf beim
Provider aus. Jetzt: vor dem Neuladen wird `POST /accounts/{accountId}/sync`
aufgerufen (`APIClient.syncAccount(id:)`, neue `SyncResult`-Antwort in
`Models/MailAccount.swift`), Fehler dort bewusst mit `try?` verschluckt
(Pull-to-Refresh soll trotzdem den lokal bereits bekannten Stand zeigen,
auch wenn der Sync-Versuch selbst fehlschlägt -- kein zweiter Error-Banner
nötig). `MockAPIClient` liefert einen Platzhalter-Erfolg. Kein eigener
Button (anders als Web) -- Pull-to-Refresh ist die iOS-native Konvention
dafür.

## [2026-09-21] Nachtrag: Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2, "getrennte Ansichten pro Konto")

Backend-Teil siehe `backend/README.md` "Mehrfach-Konten-Unterstützung"
(Commit `b6add62`), Web-Teil siehe `web/README.md` (Commit `987ab9c`).
Dieser Nachtrag ist der iOS-Teil derselben Übergabe.

`Models/Folder.swift` bekommt ein Pflichtfeld `accountId` (Ordner gehören
jetzt zu einem Konto, nicht mehr implizit zu "dem einen" Konto).
`APIClient.fetchFolders(accountId:)`/`createFolder(..., accountId:)` statt
parameterlos. `AppEnvironment.account: MailAccount?` → `accounts: [MailAccount]`
+ `activeAccountId` + `activeAccount`-Computed-Property, `loadAccount()` →
`loadAccounts(forceRefresh:)` (lädt alle, aktiviert beim ersten Laden
automatisch das erste, überschreibt eine bereits aktive Auswahl nicht),
neue `switchAccount(to:)` (verwirft `folders`/`trustedSenderAddresses` des
vorherigen Kontos) und `handleAccountAdded(_:)` (nach erfolgreichem
"Konto hinzufügen": Konten neu laden + zum neuen Konto wechseln).

`FolderListView.swift`: Titel zeigt `activeAccount`, ein Konto-Umschalter
(`Menu` im Toolbar, System-Icon "person.crop.circle") erscheint NUR bei
mehr als einem Konto (kein totes UI für den häufigeren Einzelkonto-Fall,
gleiches Prinzip wie `web/src/components/FolderSidebar.tsx`). Der
Zähler-Ladepfad (`fetchMessages(accountId:)`) ist jetzt explizit auf das
aktive Konto gescoped -- vorher `accountId: nil` (alle Nachrichten), was
bei mehreren Konten deren Zähler vermischt hätte. **Fund beim Bauen:** die
Menu-Konstruktion direkt im `.toolbar`-Builder (verschachteltes `if` +
`ForEach` + bedingtes `Label`/`Text`) ließ den Swift-Type-Checker mit
"unable to type-check in reasonable time" scheitern -- als eigene
computed property (`accountSwitcherMenu`) mit einer einfachen
String-Ternary statt Label/Text-Verzweigung kompiliert es sauber.

**"Konto hinzufügen"**: `OnboardingAccountConnectView` bekommt einen neuen
`mode: Mode = .login`-Parameter (`.login`/`.addAccount`). Im Settings-Sheet
(`FolderListView.swift`s `SettingsView`) gibt es jetzt eine Liste der
verbundenen Konten + einen "Konto hinzufügen"-Button, der denselben
Onboarding-Screen als `.sheet` präsentiert (`mode: .addAccount`, mit
"Abbrechen"-Button statt Vollbild-Gate). Gmail war auf iOS ohnehin schon
komplett deaktiviert (siehe vorheriger Nachtrag), keine zusätzliche
Sonderbehandlung für den `addAccount`-Fall nötig.

**Fund beim Bauen, ECHTER Absturz (nicht nur Compile-Fehler):**
`MockDatabase.json` hatte kein `accountId`-Feld auf den Ordner-Fixtures --
`MockAPIClient.init()` dekodiert die Datei synchron und ruft bei
Decode-Fehlern `fatalError()`, das heißt die App stürzte bei JEDEM
Start ohne Keychain-Token (also nach jeder Neuinstallation oder für jede
`#Preview`) sofort beim Launch ab, VOR jedem sichtbaren Screen. Per
Live-Simulator-Absturz entdeckt (`xcrun simctl spawn ... log show`
zeigte den exakten `DecodingError.keyNotFound`), nicht nur durch
`BUILD SUCCEEDED` angenommen. Fix: `accountId` bei allen Ordner-Fixtures
ergänzt (Wert = die einzige Mock-Account-ID `acc-001`).

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'generic/platform=iOS
Simulator' build` **BUILD SUCCEEDED**. Zusätzlich per `simctl install`+
`launch` auf einem echten Simulator verifiziert -- der obige Absturz wurde
dabei live gefunden (nicht beim Bauen sichtbar) und nach dem Fix erneut
per Screenshot bestätigt (Onboarding-Bildschirm rendert wieder normal,
kein Absturz mehr). Der Account-Switcher selbst (mehrere echte Konten
gleichzeitig) ließ sich in dieser Umgebung nicht end-to-end durchklicken
(kein `idb`, keine automatisierten Tap-Interaktionen, siehe frühere
iOS-Einträge) -- die zugrunde liegende Logik ist identisch zur bereits
per Backend-Smoketest verifizierten Mehrfach-Konten-Funktionalität.

## [2026-09-21] Nachtrag: Compose-Screen (neue Mail, Antworten, Weiterleiten, Suche, CC/BCC)

Backend-Teil siehe `backend/README.md` "Suche über Mails"/"Nachtrag: CC/BCC"
(Commit `9c3a3ec`), Web-Teil siehe `web/README.md` "Compose-Screen" (Commit
`18f36eb`). Dieser Nachtrag ist der iOS-Teil derselben vier
zusammengehörigen WEB_INBOX.md-21.09.-Aufträge (fehlender Compose-Button,
Absender-Auswahl, Weiterleiten/Suche/CC-BCC).

**Ein gemeinsamer Compose-Screen statt drei getrennter UIs:** neue Datei
`Views/ComposeView.swift`, `enum ComposeMode { case new; case
reply(MessageDetail); case forward(MessageDetail) }` (analog zu
`web/src/components/ComposeModal.tsx`s `mode`-Prop). To/CC/BCC/Betreff/
Body sind in allen drei Fällen dieselben Felder, nur die Vorbefüllung
unterscheidet sich (`setUpPrefill()`): Antworten -> An = Absender, Betreff
mit "Re:"-Präfix (idempotent), Body leer ("Antworten ohne KI-Zwang" bleibt
gültig). Weiterleiten -> Betreff mit "Fwd:"-Präfix (idempotent), Body mit
zitiertem Original (Trennzeile + Von/Datum/Betreff + Originaltext), An
leer. Ersetzt das bisherige INLINE in `MessageDetailView.swift`
eingebettete Antwortfeld (`isReplyOpen`/`replyCard(for:)` -- kein eigenes
To-Feld, kein CC/BCC, für Weiterleiten strukturell ungeeignet) komplett,
als `.sheet` präsentiert.

- **Neue Mail:** neuer Toolbar-Button in `FolderListView.swift`
  (`square.and.pencil`-Icon, neben "Neuer Ordner"), öffnet `ComposeView`
  im `.new`-Modus. Sender-`Picker` nur sichtbar bei mehr als einem
  verbundenen Konto (`environment.accounts.count > 1`), bei genau einem
  Konto automatisch dessen `accountId` (`environment.activeAccountId`).
- **Antworten/Weiterleiten:** zwei Buttons in `MessageDetailView.swift`s
  `actions(for:)`, setzen `composeMode` und präsentieren `ComposeView` als
  `.sheet`. "Antworten" bleibt bei aktuellem Ordner `spam` ausgeblendet
  (WEB_INBOX.md 09.09. "KORREKTUR der letzten Regel", unverändert),
  "Weiterleiten" ist immer sichtbar.
- **KI-Entwurf:** der optionale "KI-Entwurf"-Button (`requestReplyDraft`)
  ist nur im `.reply`-Modus sichtbar -- hat kein Äquivalent für neue Mail/
  Weiterleiten (bezieht sich auf eine Ursprungsnachricht).
- **Anhänge:** dieselbe `ComposeAttachment`/`fileImporter`-Logik wie zuvor
  in `MessageDetailView.swift`, jetzt in `ComposeView.swift`. **Grenze,
  bewusst so belassen (wie auf Web):** Original-Anhänge einer
  weitergeleiteten Mail werden NICHT automatisch mitgenommen
  (WEB_INBOX.md nannte das explizit "optional") -- der User kann aber neue
  Anhänge über denselben Weg hinzufügen.
- **CC/BCC:** zwei zusätzliche `TextField`s, hinter einem "CC/BCC
  hinzufügen"-Button eingeklappt (Superhuman-Prinzip: nur zeigen, was
  gebraucht wird, gleiches UX-Muster wie `ComposeModal.tsx`).

**`APIClient.sendMessage(...)`** (Protokoll + `RemoteAPIClient` +
`MockAPIClient`) erweitert: `inReplyToMessageId: String` (Pflicht) wurde
`inReplyToMessageId: String?` (optional), plus neue Parameter `accountId:
String?`, `cc: [String]`, `bcc: [String]` -- genau eines von `accountId`/
`inReplyToMessageId` ist erforderlich, analog zu `POST /messages/send` im
Backend. Vorher unterstützte der iOS-Client GAR KEINE neue (nicht-
antwortende) Mail, nur Antworten -- das war die eigentliche Ursache des
fehlenden Compose-Buttons, nicht nur ein UI-Problem.

**`APIClient.fetchMessages(...)`** um ein drittes Argument `query: String?`
erweitert (Suche, siehe unten) -- alle drei bestehenden Call-Sites
(`FolderListView` Zähler-Ladepfad, `InboxListView`) auf `query: nil`
umgestellt, kein Verhaltensunterschied dort.

### Suche (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN" Punkt 2)

`.searchable(text:)` auf der Ordnerliste (`FolderListView.swift`, die
einzige naheliegende Stelle für eine KONTOWEITE Suche -- sie ist die
Wurzel-Ansicht, es gibt dort keinen "aktuellen Ordner", anders als in
`InboxListView`). Bei nicht-leerem Suchbegriff ersetzt eine flache
Trefferliste (`MessageRowView`, `NavigationLink(value:)` zu
`MessageDetailView`) die Ordnerliste. 250ms entprellt über einen
abbrechbaren `Task` in `.onChange(of: searchText)` (`searchTask?.cancel()`
+ `Task.sleep`), analog zum 250ms-Debounce in `web/src/App.tsx`.
`fetchMessages(folderId: nil, accountId: environment.activeAccountId,
query:)` -- kontoweit, wie auf Web.

`MockAPIClient.fetchMessages(...)` implementiert dieselbe
Substring-Semantik wie das echte Backend (`.lowercased().contains(...)`
über subject/fromAddress/fromDisplayName/bodyText).

**Tests:** `xcodebuild -project DriftmailApp.xcodeproj -scheme
DriftmailApp -destination 'id=<Simulator-UDID>' build` **BUILD
SUCCEEDED**. Per `simctl uninstall`+`install`+`launch` auf einem echten,
laufenden Simulator (iPhone 17 Pro) sauber neu installiert (Absturz-Check
per `xcrun simctl spawn ... log show` -- kein `DecodingError`, kein
`fatalError`, gleiche Methode wie beim `accountId`-Absturzfund vom
Mehrfach-Konten-Nachtrag oben) und per Screenshot bestätigt: Onboarding-
Bildschirm rendert unverändert korrekt.

**Ehrlich benannte Grenze dieser Verifikation:** die neuen,
AUTHENTIFIZIERTEN Screens (Compose-Dialog, Suche, Antworten/Weiterleiten
in `MessageDetailView`) ließen sich in dieser Umgebung NICHT interaktiv
gegen einen echten Simulator durchklicken -- seit "voll verdrahten"
(21.09.) braucht `OnboardingAccountConnectView` für JEDEN Konto-Connect
(auch für den Mock-Entwicklungspfad) einen echten, unauthentifizierten
`RemoteAPIClient`-Request (`POST /accounts` mit `provider=imap` testet
die IMAP-Zugangsdaten serverseitig ECHT, siehe `backend/src/routes/
auth.ts` `testConnection()`) -- ohne eine echte, erreichbare Test-Mailbox
kommt man in dieser Umgebung nicht mehr am Onboarding-Gate vorbei, um
`FolderListView`/`ComposeView` überhaupt zu sehen. (Kurz erwogen: ein
env-var-gesteuerter Auth-Bypass in `AppEnvironment.init()` nur für lokale
Verifikation -- verworfen, weil das strukturell genau das Sicherheits-
Antimuster ist, das die "voll verdrahten"-Entscheidung gerade vermeiden
sollte, selbst wenn er vor dem Commit wieder entfernt worden wäre.)
Stattdessen abgesichert durch: (1) der komplette Typ-Check des SwiftUI-
View-Baums läuft durch den `xcodebuild`-Build (jede Binding-/Protokoll-
Signatur ist strukturell korrekt, sonst BUILD FAILED), (2) die Such-/
Compose-/CC-BCC-Logik ist 1:1 aus der bereits per Browser-Automation
end-to-end verifizierten Web-Implementierung übertragen (`ComposeModal.tsx`,
Commit `18f36eb`), (3) `MockAPIClient`s neue `sendMessage`/`fetchMessages`-
Zweige folgen exakt demselben Validierungsmuster wie die bereits
verifizierten bestehenden Methoden in derselben Datei. **Übergabe/offener
Punkt:** eine spätere Session mit Zugriff auf eine echte Test-Mailbox
(oder ein XCTest-UI-Test-Target mit injizierbarem `APIClient` statt der
produktiven `AppEnvironment.init()`-Logik) sollte den authentifizierten
Flow einmal live durchklicken.

## [2026-09-21] Nachtrag: KI-Anbindung (BYOK) + echte Foundation-Models-Anbindung
(TERMINAL_INBOX.md 21.09. "KORREKTUR", ersetzt WEB_INBOX.md 21.09. "ECHTE
KI-ANBINDUNG" Commit c3ec563 vollständig -- siehe `backend/README.md`
"KI-Anbindung (BYOK)" für die volle Begründung/Architektur, hier nur der
iOS-Teil)

**Kernentscheidung:** Geräte-eigene KI (Apple Foundation Models) ist die
primäre Quelle, kein driftmail-finanzierter Cloud-Key mehr. Cloud-KI nur
mit vom User selbst hinterlegtem BYOK-Key, gegen das Backend (`GET`/`PUT
/ai-settings`, siehe `backend/README.md`).

**Echte Foundation-Models-Integration, kein Stub:** `OnDeviceAiAdapter.swift`
versucht für `summarize`/`extractContract`/`draftReply` zuerst einen
ECHTEN `FoundationModels`-Aufruf (`SystemLanguageModel.default`,
`LanguageModelSession`) -- verfügbar ab iOS 26, in dieser Umgebung
tatsächlich im SDK vorhanden (Xcode 27.0/iPhoneSimulator-SDK 27.0,
per `.swiftinterface`-Inspektion verifiziert, keine Annahme). `summarize`/
`extractContract` nutzen `@Generable`/`@Guide` (FoundationModels-Makros)
für typsichere strukturierte Ausgabe (`GeneratedSummary`/
`GeneratedContractExtraction` in `OnDeviceAiAdapter.swift`) statt
manuellem JSON-Parsing wie im Backend-Pendant (`cloudAdapter.ts`) -- auf
iOS gibt es dafür einen vom System selbst schema-geführten Weg. Jeder
Aufruf ist mit `@available(iOS 26.0, *)`/`if #available` gegated und
fällt bei Nichtverfügbarkeit (ältere iOS-Version, Apple Intelligence
nicht aktiviert, Gerät nicht geeignet, Modell noch nicht bereit) ODER
einem Fehler im Aufruf selbst auf die bisherige deterministische
Keyword-Heuristik zurück (unverändert erhalten) -- nie ein harter Fehler,
analog zum Graceful-Fallback-Prinzip des Backends. Diese Heuristik-
Fallback-Ergebnisse sind jetzt ehrlich als `.heuristic` statt `.onDevice`
getaggt (dritter `AiSource`-Wert, siehe `Models/Classification.swift`).

**`analyzeMail` bewusst unverändert:** Spam-/Phishing-Klassifikation ist
explizit NICHT Teil dieser Korrektur, bleibt die bestehende Text-
Heuristik -- Sicherheitsklassifikation soll nie von einer KI-/On-Device-
Einstellung abhängen (gleiche Entscheidung wie im Backend).

**`CapabilityChecker.swift`:** `isLikelySupported` ist kein Platzhalter
mehr -- fragt `SystemLanguageModel.default.isAvailable` echt ab (neue
`OnDeviceModelAvailability`-Hilfsstruktur in `OnDeviceAiAdapter.swift`),
fällt nur auf iOS < 26 (Framework existiert dort gar nicht im SDK-Ziel)
auf die alte Geräte-Identifier-Heuristik zurück.

**`AppEnvironment.swift`:** das bisher komplett ungenutzte
`activeAdapter`/`cloudFallbackAdapter`-Paar (basierte auf dem reinen
Capability-Check, wurde nirgends aufgerufen) ist ersetzt durch echte
`summarize(messageId:bodyText:)`/`requestReplyDraft(messageId:thread:)`-
Methoden: 1) lokalen Foundation-Models-Versuch über `onDeviceAdapter`,
2) sonst `apiClient.fetchSummary`/`requestReplyDraft` -- das ruft bei
`RemoteAPIClient` den echten BYOK-/Heuristik-Pfad im Backend auf, bei
`MockAPIClient` dessen eigenen On-Device-Stub-Aufruf. `MessageDetailView.swift`
und `ComposeView.swift` (KI-Entwurf-Button) rufen jetzt diese
`AppEnvironment`-Methoden statt direkt `apiClient` auf.

**Neue Settings-UI (`Views/AiSettingsView.swift`):** eingehängt in
`FolderListView.swift`s `SettingsView` (neuer Abschnitt "KI-Anbindung").
Toggle für Cloud-KI an/aus, Provider-Picker (bewusst NUR `anthropic`/
`openai` wählbar -- die einzigen serverseitig wirklich angebundenen, siehe
`backend/README.md` -- `google`/`other` tauchen in der UI gar nicht erst
auf, obwohl der Typ sie kennt), `SecureField` für den API-Key (nie
angezeigt/geloggt), Consent-Toggle mit ausformuliertem Zustimmungstext.
`APIClient` bekam `fetchAiSettings()`/`updateAiSettings(...)` (Protokoll +
`RemoteAPIClient`/`MockAPIClient`), `requestReplyDraft` liefert jetzt
zusätzlich `source` (vorher fehlte das Feld komplett, siehe api-spec.yaml-
Korrektur im Backend-Commit). Neuer `APIError.badRequest(message:)`-Fall
für die 400-Antwort bei nicht angebundenem Provider/fehlendem Key.

**Bewusst KEIN eigener Onboarding-Schritt** -- lebt in den Einstellungen,
gleiche Begründung wie im Backend (Default "aus", die meisten User
brauchen nie einen Cloud-Consent-Dialog).

**Tests:**
1. `xcodebuild -scheme DriftmailApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`
   **BUILD SUCCEEDED**, inkl. der neuen `FoundationModels`-Abhängigkeit
   (Swift Macro Plugin `FoundationModelsMacros` wird beim Build sichtbar
   geladen).
2. Sauberer Uninstall→Install→Launch auf einem echten gebooteten
   Simulator (iPhone 17 Pro), Screenshot bestätigt den unveränderten
   Onboarding-Screen (Provider-Auswahl rendert korrekt), `simctl spawn log
   show` nach dem Kaltstart zeigt KEINEN Crash/`DecodingError`/
   `fatalError` (nur die erwartete DNS-Fehlermeldung, weil ohne
   `DRIFTMAIL_API_BASE_URL` gegen die echte, hier nicht erreichbare
   Produktions-URL versucht wird).
3. **Echte Verifikation der Foundation-Models-API außerhalb der App-UI**
   (die authentifizierten Screens sind weiterhin durchs bekannte
   Onboarding-Gate blockiert, siehe Nachtrag "Mehrfach-Konten"/"Compose-
   Screen" oben -- keine echte Test-Mailbox in dieser Umgebung
   verfügbar, kein erneuter Bypass-Versuch): ein eigenständiges
   Swift-Kommandozeilen-Programm (nicht Teil der App, nur zur
   Verifikation, danach gelöscht) mit exakt demselben API-Aufrufmuster
   wie `OnDeviceAiAdapter.swift`, kompiliert gegen dieselbe SDK-Version
   auf diesem Host:
   - `SystemLanguageModel.default.availability` liefert echt `.available`
     in dieser Umgebung (nicht angenommen, tatsächlich ausgeführt).
   - Ein echter `LanguageModelSession.respond(to:)`-Aufruf (Freitext)
     liefert eine echte Modellantwort.
   - Ein echter `respond(to:generating:)`-Aufruf mit einem `@Generable`-
     Testtyp (identisches Muster zu `GeneratedSummary`) liefert eine
     echte strukturierte Antwort (`summaryText`/`actionRequired` korrekt
     befüllt).
   Das beweist, dass die verwendete API real funktioniert und nicht nur
   typprüft -- **nicht** bewiesen ist, dass genau `OnDeviceAiAdapter.swift`
   innerhalb der laufenden App denselben Pfad nimmt (dafür fehlt weiterhin
   der Klick-Zugriff auf die authentifizierten Screens), aber Build-Erfolg
   + identisches, extern verifiziertes API-Muster geben dafür hohe
   Zuversicht.

**Ehrlich benannte Verifikations-Grenze (unverändert seit den vorherigen
Nachträgen):** die authentifizierten Screens (inkl. `AiSettingsView`
selbst) ließen sich in dieser Umgebung weiterhin NICHT interaktiv
durchklicken -- gleiche Ursache wie beim Compose-Screen-Nachtrag oben.
**Offener Punkt für eine spätere Session:** `AiSettingsView` einmal mit
echter Test-Mailbox oder einem XCTest-UI-Test-Target live durchklicken
(Toggle → Provider wählen → Key eingeben → Speichern → Fehlerfall mit
ungültigem Provider prüfen).

## [2026-09-21] Nachtrag: kleine Ergänzungen (Label-Umbenennung, Absender-vertrauen-Button)

- **Label-Umbenennung** (WEB_INBOX.md 21.09. "KLEINE LABEL-AENDERUNG"): der
  Button "Inhalt" (KI-Zusammenfassung, `MessageDetailView.swift`) heißt
  jetzt "Check Mail" -- ausdrücklich von Massimo so entschieden. Reine
  Text-Änderung.
- **"Absender vertrauen" direkt am Badge** (WEB_INBOX.md 21.09. "KLEINE
  VERKNUEPFUNG"): `SecurityBadgesView` bekommt einen `onTrustSender`-
  Closure, sichtbar direkt neben dem "Neuer Absender"-Flag. Ruft
  `AppEnvironment.trustSender(_:)` (neu) auf, das `POST /trusted-senders`
  aufruft und `trustedSenderAddresses` optimistisch aktualisiert -- das
  Badge verschwindet sofort für alle Nachrichten dieses Absenders. Dafür
  neu: `APIClient.addTrustedSender(senderAddress:)` in Protokoll +
  `MockAPIClient` + `RemoteAPIClient` -- `POST /trusted-senders` existierte
  im Contract bereits seit dem Whitelist-Auftrag (15.09.), iOS hatte bisher
  nur `GET /trusted-senders` (lesend) angebunden.

**Tests:** `xcodebuild` BUILD SUCCEEDED, sauberer Uninstall/Install/
Launch ohne Crash/Decode-Fehler (Onboarding-Screen unverändert korrekt
gerendert). Die neuen UI-Elemente selbst (Button-Tap) ließen sich in
dieser Umgebung NICHT interaktiv verifizieren -- gleiche Ursache wie bei
den vorherigen Nachträgen (kein Weg an das Onboarding-Gate vorbei ohne
echte Test-Mailbox).

## [2026-09-21] Nachtrag: Einstellungsbereich
(WEB_INBOX.md 21.09. "NEUER AUFTRAG - Einstellungsbereich + Info-Seite",
Punkt 1 -- Punkt 2, die öffentliche driftware.online-Info-Seite, wird laut
Massimo in einer separaten Claude-Session gebaut, bewusst nicht angefasst)

`SettingsView` (private struct in `FolderListView.swift`) existierte
bereits mit App-Sperre-Toggle, Konten-Liste (nur Anzeigen + Hinzufügen)
und KI-Anbindung-Link -- dieser Nachtrag erweitert die bestehende Fläche,
baut keine neue.

**1) Konto entfernen:** `.swipeActions` auf jeder Konto-Zeile, ruft
`AppEnvironment.removeAccount(_:)` (neu) → `DELETE /accounts/{id}` auf.
Das letzte verbleibende Konto wird client-seitig gar nicht erst als
entfernbar angeboten (`environment.accounts.count > 1`-Check), der Server
prüft denselben Fall trotzdem nochmal (`APIError.badRequest`
abgefangen und als Fehlertext angezeigt, falls die Wischgeste doch mal
vor einer veralteten Kontenliste ausgelöst würde). Nach erfolgreichem
Entfernen lädt `removeAccount(_:)` `accounts` neu -- war das entfernte
Konto das aktive, wählt `loadAccounts()` automatisch ein verbleibendes
(bestehende Logik, unverändert), `folders`/`trustedSenderAddresses` werden
dabei zurückgesetzt wie bei einem normalen Kontowechsel. Neu in
`APIClient`/`MockAPIClient`/`RemoteAPIClient`: `deleteAccount(id:)` --
eigene Implementierung in `RemoteAPIClient` (nicht der generische
`delete()`-Helper, der prüft gar keinen Statuscode) für den erwarteten
400-Fall, analog zu `updateAiSettings`.

**2) Neue "Ansicht"-Sektion -- Akzentfarben-Auswahl:** fünf Farb-Swatches
aus dem neuen `AccentTheme`-Enum (`Models/UserSettings.swift`, Werte 1:1
aus `contracts/design-tokens.json` `color.accentThemes` übernommen,
`ocean_verlauf` als echter `LinearGradient`-Swatch statt einer flachen
Farbe, damit er auf einen Blick als Verlauf erkennbar ist). Tippen ruft
`AppEnvironment.updateAccentTheme(_:)` → `PUT /settings` auf.

**Live-Umfärben ohne App-Neustart -- die eigentliche Design-Entscheidung
dieses Nachtrags:** `DesignTokens.Color.accent` war bisher ein `static
let`, also unveränderlich zur Laufzeit. Elegante Lösung mit minimalem
Diff statt eines großen Refactors: die Property wurde zu `static var`,
UND `AppEnvironment` bekam ein neues `@Published private(set) var
accentTheme`. `applyAccentTheme(_:)` (privat) setzt BEIDE bei jeder
Änderung zusammen -- die vier Views, die `DesignTokens.Color.accent`
schon heute direkt lesen UND bereits `environment` als
`@EnvironmentObject` beobachten (`FolderListView`, `MessageDetailView`,
`OnboardingCapabilityCheckView`, `RootView`), zeichnen dadurch automatisch
neu und lesen dabei den frisch gesetzten Wert -- ohne dass einer der
bestehenden 14 `DesignTokens.Color.accent`-Aufrufe in diesen Dateien
angefasst werden musste. **Bewusst NICHT umgestellt:**
`AppLockGateView`/`OnboardingAccountConnectView` -- beide laufen VOR dem
Laden irgendeiner Einstellung (Sperrbildschirm/Onboarding), es gibt dort
noch keine personalisierte Farbe, die anzuzeigen wäre; der statische
Default (`teal`) ist dort das korrekte Verhalten, kein Kompromiss.
`loadSettings()` (neu) lädt die gespeicherte Farbe einmal beim App-Start
(`FolderListView.task`, analog zu `loadAccounts()`/`loadFolders()`), nicht
erst beim ersten Öffnen der Einstellungen.

**3) Sicherheits-Übersicht:** einfacher, nicht-technischer Text-Block
(exakter Wortlaut von Massimo vorgegeben) in einer eigenen Section
zwischen App-Sperre und KI-Anbindung. Nennt Malware-Scan bewusst als "in
Vorbereitung" -- der ist tatsächlich noch ein Mock
(`backend/src/lookups/attachmentScanMock.ts`), keine Übertreibung.

**4) "Hilfe"-Sektion:** ein `Link` auf `https://driftware.online` als
Platzhalter, bis die andere Claude-Session die eigentliche Info-Seite
fertig hat -- Kommentar im Code verweist darauf, die Route bei
Gelegenheit zu verschärfen.

**Tests:** `xcodebuild` BUILD SUCCEEDED (der komplette SwiftUI-View-Baum
inkl. aller neuen Bindings/Closures/`ForEach`s über `AccentTheme.allCases`
ist strukturell korrekt, sonst BUILD FAILED). Sauberer Uninstall/Install/
Launch ohne Crash/Decode-Fehler, Onboarding-Screen unverändert korrekt
gerendert (Screenshot verifiziert). Die neuen Settings-Sektionen selbst
ließen sich NICHT interaktiv durchklicken -- gleiche Ursache wie bei allen
vorherigen Nachträgen dieser Session (kein Weg an das Onboarding-Gate
vorbei ohne echte Test-Mailbox, kein Auth-Bypass versucht). **Offener
Punkt für eine spätere Session:** einmal mit echter Test-Mailbox live
durchklicken (Konto entfernen inkl. Fehlerfall bei nur einem Konto,
Akzentfarbe wechseln und live sehen, dass sich z.B. `FolderListView`s
aktives Konto/die Buttons tatsächlich umfärben).

## [2026-09-21] Nachtrag: Fünf Komfort-Features

WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES". Backend-Grundlage
(Settings-Feld `strictUnknownSenders`, `GET /contacts`, `inReplyToMessageId`
jetzt auch auf `Message` statt nur `MessageDetail`, `POST`/`PATCH /drafts`)
kam bereits aus einem früheren Schritt dieser Session (Commit `571ee2c`).
Dieser Nachtrag ist die iOS-UI dazu, Punkte 1–4. Punkt 5 (manueller
Abmelden-Button) war schon vollständig vorhanden -- `MessageDetailView`s
"Abmelden"-Button hängt nicht an der Spam-Klassifikation, sondern rein an
`detail.canUnsubscribe`, geprüft und bestätigt, keine Änderung nötig.

**1. Unbekannte Absender streng behandeln.** Neuer Toggle in
`FolderListView.SettingsView` ("Unbekannte Absender streng behandeln"),
Default an (`AppEnvironment.strictUnknownSenders`, aus `UserSettings`
geladen). Wirkt sich nur auf `MessageDetailView` aus, nicht auf die
Listenansicht -- `isNewSender` existiert im Contract nur auf
`MessageDetail`, nicht auf dem schlankeren `Message`-Shape der Liste, also
gibt es dort schlicht kein Signal, das man stärker hervorheben könnte.
`MessageDetailView.isStrictlyFlagged(_:)` prüft
`strictUnknownSenders && detail.isNewSender && !trustedSenderAddresses.contains(...)`
und hebt den Header-Block bei Treffer mit `warning`-Hintergrund/-Rahmen
hervor (gleiche Farbrolle wie die bestehende Quarantäne-Warnung, nur
dezenter).

**2. Kontakt-Autovervollständigung beim Verfassen.** `ComposeView` hat
jetzt `@FocusState private var focusedField: ComposeField?` (to/cc/bcc)
und zeigt unter dem jeweils fokussierten Feld bis zu 5 Vorschläge aus
`AppEnvironment.contacts` (`GET /contacts`, serverseitig aus
Nachrichten-Historie + Sendeprotokoll dedupliziert -- keine neue
Kontakte-Tabelle, wie im Auftrag vorgegeben). Der Vorschlag matcht gegen
das letzte, noch unfertige Adress-Fragment nach dem letzten Komma, damit
Mehrfachadressen im selben Feld funktionieren.

**3. Entwürfe automatisch speichern während des Tippens.** Neuer
Debounce (3s Stille nach der letzten Änderung an To/CC/Betreff/Body) über
`scheduleAutosave()`/`performAutosave()`, plus ein sofortiger Flush in
`.onDisappear`, falls noch ungesicherter Inhalt da ist. Der erste
Autosave legt via `POST /drafts` einen neuen Entwurf an und merkt sich
dessen `id` (`@State private var draftId`); jeder weitere Autosave ist ein
`PATCH /drafts/{id}`. Fehler dabei sind bewusst still (best-effort,
kein Retry, kein User-Feedback) -- ein fehlgeschlagener Autosave darf das
Tippen nicht unterbrechen. **Bekannte Lücke, ehrlich benannt:** der
Contract von `POST`/`PATCH /drafts` hat kein `bcc`-Feld (nur `to`, `cc`,
`subject`, `bodyText`), anders als `POST /messages/send`. Ein getipptes
BCC wird also während des Autosaves NICHT mitgespeichert -- es geht beim
eigentlichen Senden nicht verloren (das unterstützt `bcc` sehr wohl), aber
würde man denselben ungesendeten Entwurf später erneut öffnen, wäre ein
zuvor nur autogespeichertes BCC weg. Für dieses Nachtrag out of scope
(Contract-Änderung wäre ein Web+Backend+iOS-übergreifender Schritt).

**4. Threaded Ansicht.** `InboxListView` gruppiert die geladenen
Nachrichten jetzt über `groupIntoThreads(_:)`: jede Nachricht wird bis zum
am weitesten zurückverfolgbaren Elternteil verfolgt (`inReplyToMessageId`),
Nachrichten mit demselben Wurzel-Vorfahren bilden einen Thread. Es wird
immer nur die neueste Nachricht eines Threads direkt angezeigt, mit einem
"+N ältere"-Button zum Aufklappen. **Bewusste Grenze:** die Auflösung
läuft ausschließlich innerhalb der gerade geladenen Ordner-Liste -- ein
Elternteil in einem anderen Ordner (z.B. eine eigene gesendete Antwort im
"Gesendet"-Ordner, während man im "Posteingang" browst) wird nicht
nachgeladen und bleibt daher unverknüpft. Gleiche Grenze wie in
`backend/README.md` für die Server-Seite dokumentiert. Für realistische
Test-Daten wurde `MockDatabase.json` um `msg-014` erweitert, eine echte
Antwort auf `msg-001` ("Re: Projektupdate bis Freitag benötigt"), plus
`inReplyToMessageId: null` auf allen 13 vorherigen Nachrichten (Feld war
vorher nur auf `MessageDetail`, jetzt auch auf `Message`).

**Neu in `APIClient`/`MockAPIClient`/`RemoteAPIClient`:**
`updateSettings(accentTheme:strictUnknownSenders:)` (beide Parameter
optional, unabhängig voneinander setzbar -- Swifts synthetisiertes
`Encodable` lässt `nil`-Optionals beim Encoding komplett weg statt sie
als `null` zu senden, also überschreibt ein `nil` das jeweils andere Feld
nicht; gleiches Muster wie das schon bestehende `updateFolder`),
`fetchContacts() -> [String]`, `createDraft(inReplyToMessageId:to:cc:subject:bodyText:)`
und `updateDraft(id:to:cc:subject:bodyText:)`.

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'platform=iOS
Simulator,name=iPhone 17 Pro' build` → BUILD SUCCEEDED. Sauberer
Uninstall/Install/Launch, `log show` auf Crash/Fatal/DecodingError
geprüft -- keine Treffer (bestätigt u.a., dass die `MockDatabase.json`-
Erweiterung beim kalten Start nicht crasht). Screenshot bestätigt
unveränderten, korrekt gerenderten Onboarding-Screen. Wie bei allen
vorherigen Nachträgen dieser Session ließen sich die neuen Screens selbst
(Settings-Toggle, Compose-Autocomplete, Thread-Aufklappen) NICHT
interaktiv durchklicken -- kein Weg am Onboarding-Gate vorbei ohne echte
Test-Mailbox, kein Auth-Bypass versucht. **Offener Punkt für eine
spätere Session:** einmal mit echter Test-Mailbox live durchklicken.

## [2026-09-21] Nachtrag: Abwesenheitsassistent

WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent". Backend
(`GET`/`PUT /absence-responder`, Sicherheitslogik im Sync-Pfad, echte
`/signatures`-Implementierung) kam aus einem früheren Schritt dieser
Session (Commits `fc4e287`/`7215149`). Dieser Nachtrag ist die iOS-UI dazu.

**Einstellungsbildschirm.** Neuer eigener Screen `AbsenceResponderView`
(gleicher Aufbau wie `AiSettingsView`: der Ein/Aus-Toggle steuert nur
lokalen Zustand, "Speichern" löst erst den echten `PUT`-Aufruf aus),
erreichbar über einen neuen `NavigationLink("Abwesenheitsassistent")` in
`FolderListView.SettingsView`, direkt unter "KI-Anbindung". Enthält Start-
`DatePicker` (Pflicht bei aktivem Assistenten), einen "Enddatum
festlegen"-Toggle mit optionalem End-`DatePicker`, sowie Betreff-
`TextField` und Text-`TextEditor`.

**Aktiver Banner.** `FolderListView` zeigt oben in der Ordnerliste (nicht
während einer aktiven Suche) einen Hinweis mit Flugzeug-Icon, solange
`AppEnvironment.absenceResponder?.active == true`, inkl. Enddatum falls
gesetzt und einer direkten "Jetzt beenden"-Schnellaktion. Diese setzt
NUR `active: false` -- Start-/Enddatum, Betreff und Text bleiben
gespeichert, ein erneutes Aktivieren im Einstellungsbildschirm findet die
vorherige Konfiguration unverändert vor (siehe COALESCE-Semantik unten).
Zustand wird beim App-Start und nach jedem Schließen des
Einstellungs-Sheets neu geladen (analog zu `loadFolders(forceRefresh:)`).

**Neues Modell `AbsenceResponder`** (`active`, `startDate`, `endDate`,
`subject`, `body`). `startDate`/`endDate` bewusst als rohe `String?`
("yyyy-MM-dd") statt `Date` -- es gab in diesem Scaffold noch keine
etablierte Konvention, ein `Date`-Feld bei einem AUSGEHENDEN `PUT`-Request
wieder korrekt als Datums-String zu kodieren (der generische
`JSONEncoder()` würde ohne eigene `dateEncodingStrategy` sonst einen
Unix-Timestamp senden, siehe bisherige `Date`-Felder wie
`Contract.contractEnd` -- die kommen nur EINGEHEND vor). Umwandlung
zu/von `Date` für die `DatePicker`-Bindings passiert lokal in der View
über den bereits vorhandenen `DriftmailDateDecoding.dateOnly`-Formatter.

**Neu in `APIClient`/`RemoteAPIClient`/`MockAPIClient`:**
`fetchAbsenceResponder()` und
`updateAbsenceResponder(active:startDate:endDate:clearEndDate:subject:body:)`.
`nil`-Parameter lassen das jeweilige Feld serverseitig unangetastet
(COALESCE-artig, exakt wie `updateSettings(accentTheme:strictUnknownSenders:)`
aus dem vorherigen Nachtrag) -- Swifts synthetisiertes `Encodable` lässt
`nil`-Optionals beim Encoding komplett weg statt sie als `null` zu senden.
**Eine Besonderheit:** `endDate` braucht zusätzlich einen expliziten
Lösch-Weg (ein zuvor gesetztes Enddatum wieder entfernen, ohne den ganzen
Assistenten zu deaktivieren) -- normales `nil` kann das nicht ausdrücken
(bedeutet ja "unangetastet lassen"), deshalb ein eigener `clearEndDate:
Bool`-Parameter, der in `RemoteAPIClient` über ein manuelles `encode(to:)`
(statt des generischen synthetisierten) ein echtes JSON-`null` statt eines
weggelassenen Felds sendet.

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'platform=iOS
Simulator,name=iPhone 17' build` → BUILD SUCCEEDED (neue Dateien manuell
in `DriftmailApp.xcodeproj/project.pbxproj` eingetragen, da dieses Projekt
keine Ordner-Referenzen nutzt, siehe Kopfkommentar der Datei). Sauberer
Uninstall/Install/Launch auf einem gebooteten Simulator, `log show` auf
Crash/Fatal/DecodingError geprüft -- keine Treffer. Screenshot bestätigt
unveränderten, korrekt gerenderten Onboarding-Screen. Wie bei allen
vorherigen Nachträgen dieser Session ließ sich der neue Screen selbst
NICHT interaktiv durchklicken -- kein Weg am Onboarding-Gate vorbei ohne
echte Test-Mailbox, kein Auth-Bypass versucht. **Offener Punkt für eine
spätere Session:** einmal mit echter Test-Mailbox live durchklicken
(Toggle, Speichern, Banner, "Jetzt beenden").

## [2026-09-21] Nachtrag: Design-Richtung (Superhuman-Stil)

WEB_INBOX.md 21.09. "DESIGN-RICHTUNG - von Massimo bestaetigt" -- naechster
Punkt in Massimos festgelegter Reihenfolge (nach den Grundfunktions-
Luecken, vor den 5 Wettbewerbs-Features). Kein Contract-Change, reine
visuelle Ueberpruefung/Anpassung gegen die 5 bestaetigten Struktur-
Prinzipien.

**Ausgangslage:** die App war bereits sehr nah an der Zielrichtung (schlanke
`.plain`-Listen ohne Karten/Schatten, kompakte Zeilen in `MessageRowView`,
sichtbarer Compose-Button, keine `.shadow()`-Aufrufe irgendwo im Code) --
das ist ueber die Session organisch so entstanden, kein grosser Umbau
noetig. Systematisch gegen alle 5 Punkte geprueft:

1. **Schmale, reduzierte Ordnerliste:** `FolderListView` nutzt bereits
   `.listStyle(.plain)` mit kompakten Zeilen -- kein Aenderungsbedarf.
2. **Kompakte Listenzeilen:** `MessageRowView` hatte bereits Absender/
   Betreff/Zeitstempel-rechtsbuendig in einer einzeiligen, unaufdringlichen
   Zeile ohne Karten-Optik. **Bewusste Grenze:** "Absender fett wenn
   ungelesen" laesst sich NICHT umsetzen -- es gibt weder im Contract
   (`ApiMessage`) noch irgendwo im iOS-Code ein Gelesen/Ungelesen-Konzept
   fuer Nachrichten (Volltextsuche: keine Treffer fuer `isRead`/`unread`
   ausserhalb eines Kommentars). Das waere ein echter Contract-Change,
   der Auftrag verlangt ausdruecklich "Kein Contract-Change" -- absichtlich
   nicht erfunden, hier als offene Luecke dokumentiert statt stillschweigend
   uebergangen.
3. **Genau EIN Akzent pro Ansicht -- der eigentliche Fund:**
   `FolderListView.FolderRow` faerbte JEDES Ordner-Icon in der
   User-Akzentfarbe ein (nur Quarantaene korrekt in `danger`), unabhaengig
   vom Zustand -- eine 7-fach wiederholte Akzentfarbe in der Liste ist das
   genaue Gegenteil von "ein Akzent pro Ansicht" und verwaesserte den
   Kontrast zur echten Quarantaene-Warnung. Behoben: Ordner-Icons sind jetzt
   neutral (`textSecondary`), nur die Quarantaene behaelt `danger`.
   Alle uebrigen Akzent-Verwendungen im Code wurden einzeln gegengeprueft
   (`grep DesignTokens.Color.accent`) und sind bereits korrekt: `.tint()`
   auf Buttons/Controls, je ein Hero-Icon auf Onboarding-/Lock-Screens (ein
   Screen, ein Akzent), die "Check Mail"-Zusammenfassungskarte in
   `MessageDetailView` (eine Karte pro Nachrichtenansicht) und der aktive
   Konto-Haken im Kontoumschalter -- keine weiteren Aenderungen noetig.
   Alle bestehenden `danger`/`warning`-Sicherheitshinweise (Anzeigename-
   Spoofing, IBAN-Wechsel, Quarantaene-Banner etc.) waren immer schon
   korrekt auf diese beiden Farbrollen beschraenkt, nie auf die
   User-Akzentfarbe -- unveraendert.
4. **"Neue Nachricht"-Button:** existiert bereits sichtbar in der
   Toolbar von `FolderListView` (Stift-Icon) -- kein Aenderungsbedarf.
5. **Cmd/Ctrl+K-Hinweis:** laut Auftrag "kein Muss fuer den ersten
   Entwurf" und ein reines Tastatur-/Desktop-Konzept -- fuer iOS/Touch
   bewusst NICHT uebertragen (kein sinnvolles Aequivalent), Suche existiert
   bereits ueber die native `.searchable()`-Leiste.

**Geaenderte Datei:** `ios/DriftmailApp/Views/FolderListView.swift`
(`FolderRow`, eine Zeile).

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'platform=iOS
Simulator,name=iPhone 17' build` → BUILD SUCCEEDED. Sauberer Uninstall/
Install/Launch auf einem gebooteten Simulator, `log show` auf Crash/Fatal
geprueft -- keine Treffer. Screenshot bestaetigt unveraenderten,
korrekt gerenderten Onboarding-Screen (gleiche bekannte Grenze wie bei
jedem vorherigen Nachtrag dieser Session: kein Weg am Onboarding-Gate
vorbei ohne echte Test-Mailbox, die eigentliche Ordner-/Nachrichtenliste
liess sich deshalb nicht live gegenpruefen, nur durch Code-Review +
erfolgreichen Build verifiziert).

## [2026-09-21] Nachtrag: Neun neue Features (Nudge, Vertraulicher Modus,
Vergessener-Anhang, Malware-Scan-Anzeige, Tracking-Schutz-Einstellung,
Undo Send, Darkweb-Ueberwachung, Schedule Send, Snooze)

WEB_INBOX.md 21.09.: iOS-UI fuer neun Features, deren Backend-Seite (Track
A) bereits fertig und gepusht war (Contract-Erweiterungen + `sendMessage`/
`schedule`/`snooze`-Endpunkte, echter ClamAV-Scan, Darkweb-Mock). Priorität
laut Auftrag "lieber alle 9 sauber mit klar benannten Luecken dokumentiert,
als 5 perfekt und 4 komplett fehlend ohne Erklaerung" -- alle 9 sind
umgesetzt, mit den unten einzeln genannten bewussten Vereinfachungen.

1. **Nudge** (`Message.awaitingReply`): dezentes Uhr-Symbol neben dem
   Betreff in `MessageRowView`, Einstellungs-Toggle
   "An unbeantwortete Mails erinnern" in `SettingsView`
   (`AppEnvironment.updateNudgeUnansweredEnabled(_:)`).
2. **Vertraulicher Modus** (`sendMessage(...confidentialUntil:)`):
   Toggle + Ablauf-`DatePicker` in `ComposeView`. **Bewusst rein manuell**
   -- kein automatischer Vorschlag, der bräuchte `POST
   /messages/draft/phishing-check`s `containsSensitiveData`, das im
   Compose-Screen bisher nirgends aufgerufen wird (per Grep bestaetigt:
   kein einziger Aufruf dieses Endpunkts im iOS-Code). `MessageDetailView`
   zeigt den Ablaufzeitpunkt bzw. nach Ablauf einen ehrlichen
   "Inhalt wurde geloescht"-Hinweis (`confidentialBanner(until:bodyGone:)`).
3. **Vergessener-Anhang-Erkennung**: rein client-seitige Substring-
   Heuristik (`ComposeView.attachmentMentionKeywords`) -- wenn der
   Nachrichtentext ein Wort wie "Anhang"/"anbei"/"attached" enthaelt,
   aber kein Anhang angefuegt ist, fragt ein `confirmationDialog` vor dem
   Senden nach. Kein NLP, kein Server-Aufruf.
4. **Malware-Scan-Anzeige** (`MessageDetail.attachments`, echter ClamAV-
   Scan serverseitig): `attachmentsCard(_:)` in `MessageDetailView` zeigt
   jeden Anhang mit seinem `scanStatus` (`AttachmentScanStatus.label`,
   jetzt zentral im Modell statt dupliziert -- `ComposeAttachmentUiStatus.
   label` delegiert seit diesem Nachtrag an dieselbe Property). Kein
   Datei-Oeffnen-Weg (die App hat ohnehin keinen Dateibetrachter), reine
   Information/Warnung.
5. **Tracking-Schutz-Einstellung** (`GET`/`PUT /privacy-settings`): zwei
   Toggles in `SettingsView` ("Externe Bilder blockieren"/"Tracking-Links
   blockieren"). Footer erklaert ehrlich, dass "Externe Bilder
   blockieren" aktuell keine technische Wirkung hat, weil driftmail
   Mail-Inhalte nur als Klartext zeigt (siehe `PrivacySettings.swift`-
   Kommentar) -- kein vorgetaeuschter Schutz.
6. **Undo Send**: rein client-seitiger Mechanismus, KEIN Server-Pendant
   (der Contract kennt kein "Senden zurueckziehen"). `ComposeView.send()`
   loest keinen sofortigen `sendMessage`-Aufruf mehr aus, sondern startet
   einen 6-Sekunden-Countdown (`beginUndoSendCountdown()`) mit einer
   Banner-Leiste ("Wird in Xs gesendet… [Rueckgaengig]"); erst danach
   feuert `dispatchSend()`. Sowohl "Verwerfen" als auch das Wegwischen des
   Compose-Sheets brechen einen laufenden Countdown mit ab (`cancelUndoSend()`
   in beiden Pfaden verdrahtet) -- ohne das wuerde die Nachricht trotz
   "Verwerfen" nach Ablauf noch rausgehen. **Dokumentierte Grenze:**
   funktioniert nur, solange der Compose-Screen offen bleibt; ein
   Force-Quit der App waehrend des Countdowns sendet die Nachricht NICHT
   (kein Hintergrund-Task), anders als ein serverseitiges Undo-Send.
7. **Darkweb-/Datenleck-Ueberwachung** (`GET`/`PATCH /security/breaches`,
   backend-seitig gemockt): neuer `DataBreachListView.swift`-Screen,
   verlinkt aus `SettingsView` mit einem Zaehler-Badge fuer noch nicht
   bestaetigte Funde (`AppEnvironment.unacknowledgedBreachCount`).
8. **Schedule Send** (`POST /drafts` mit `scheduledFor`, `PATCH
   /drafts/{id}` mit `scheduledFor: null`): Toggle + `DatePicker` in
   `ComposeView`, Senden-Button wird zu "Planen". `DraftListView` zeigt
   geplante Entwuerfe mit Zeitpunkt-Label und einer "Planung aufheben"-
   Swipe-Aktion (`cancelScheduledDraft`). **Dokumentierte Grenze:** falls
   bereits ein Autosave-Entwurf existiert, legt "Planen" einen ZWEITEN,
   eigenen Entwurf an (der Contract kennt kein "bestehenden Entwurf
   nachtraeglich planen") -- der ungeplante Autosave-Entwurf bleibt dann
   zusaetzlich in "Entwürfe" zurueck.
9. **Snooze** (`POST /messages/{id}/snooze`): Swipe-Aktion "Später" in
   `InboxListView` (3 feste Zeitpunkte: heute Abend, morgen frueh,
   naechste Woche Montag) sowie ein gleichwertiges Menü in
   `MessageDetailView`. `MessageDetailView` zeigt zusaetzlich einen
   Banner mit "Jetzt zeigen"-Sofort-Aufhebung, falls eine bereits
   zurueckgestellte Nachricht direkt (z. B. über einen alten Link) erneut
   geoeffnet wird.

**Uebergreifende Aenderungen:**
- `Networking/RemoteAPIClient.swift`: Date-Felder in ausgehenden
  Request-Bodies (`confidentialUntil`, `scheduledFor`, `until`) werden
  als ISO-8601-`String` codiert (`Self.iso8601String(_:)`) statt als
  rohe `Date` -- die Datei hatte bisher (7 bestehende Call-Sites geprueft
  per Grep) NIRGENDS eine `JSONEncoder.dateEncodingStrategy` gesetzt,
  Swifts Default waere eine `timeIntervalSinceReferenceDate`-Zahl gewesen,
  die das Backend nicht verstanden haette. Bewusst pro Call-Site als
  `String` konvertiert statt eines globalen Encoders, analog zum
  bestehenden Muster bei `updateAbsenceResponder`s `startDate`/`endDate`
  (dort ebenfalls plain `String`, nicht `Date`, end-to-end).
- Alle neuen/gewachsenen `APIClient`-Methoden (`updateSettings(...
  nudgeUnansweredEnabled:)`, `fetchPrivacySettings`/
  `updatePrivacySettings`, `fetchBreaches`/`acknowledgeBreach`,
  `scheduleDraft`/`cancelScheduledDraft`, `snoozeMessage`, `sendMessage(...
  confidentialUntil:)`) sind in `MockAPIClient` vollstaendig nachgebaut
  (inkl. Pflichtfeld-/Zukunfts-Validierung fuer Schedule Send, analog zum
  echten Backend), nicht nur in `RemoteAPIClient`.
- Zwei neue Modelldateien (`Models/PrivacySettings.swift`,
  `Models/DataBreachFinding.swift`) sowie `DataBreachListView.swift`
  wurden manuell in `DriftmailApp.xcodeproj/project.pbxproj` registriert
  (kein Xcode-GUI in dieser Umgebung verfuegbar -- direkt per Skript in
  den `PBXBuildFile`/`PBXFileReference`/`PBXGroup`/`PBXSourcesBuildPhase`-
  Sektionen ergaenzt, nach demselben ID-Schema wie bestehende Eintraege).

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'platform=iOS
Simulator,name=iPhone 17' build` → BUILD SUCCEEDED. Uninstall/Install/
Launch auf einem gebooteten Simulator, `log show` auf Crash/Fatal geprueft
-- keine Treffer. Zusaetzlich zur ueblichen Verifikation dieser Session:
`AppEnvironment.init()` wurde EINMALIG temporaer so geaendert, dass sie
immer `MockAPIClient`+`isAuthenticated: true` liefert (Onboarding-Gate
umgangen), neu gebaut, installiert und gestartet, um zu bestaetigen, dass
die App ueber das Onboarding-Gate hinaus startet, ohne abzustuerzen (der
Capability-Check-Screen erschien korrekt, "On-Device-KI verfuegbar"
erkannt) -- danach sofort wieder auf den Original-Code zurueckgesetzt
(siehe `git diff` vor dem Commit, keine Spur dieser Aenderung im
Endergebnis). Kein XCUITest-Target vorhanden, daher keine automatisierten
Taps durch die neuen Screens (Compose-Toggles, Snooze-Menü, Darkweb-Liste)
-- nur per Code-Review + erfolgreichem Build + Crash-freiem Start
verifiziert, dieselbe dokumentierte Grenze wie bei jedem vorherigen
Nachtrag dieser Session ohne echte Test-Mailbox.

## [2026-09-22] Nachtrag: HTML-Rendering des Mail-Bodies (WKWebView, sandboxed)

WEB_INBOX.md 22.09. "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies" --
iOS-Teil, nachdem Track A (Backend) bereits fertig und gepusht war
(Commit `6236f36`/`c0f39bc`, siehe backend/README.md "HTML-Rendering des
Mail-Bodies"). Der Backend-Teil liefert `MessageDetail.bodyHtml` (bereits
serverseitig sanitisiert, Links auf `/link-check` umgeschrieben,
Remote-Bild-`src` bereits entfernt bei aktivem `blockRemoteImages`) und
`MessageDetail.links` -- dieser Nachtrag ist die iOS-UI, die `bodyHtml`
tatsächlich sicher anzeigt (Web-Gegenstück läuft parallel, eigener
Sync.md-Eintrag).

**Non-verhandelbare Sicherheitsanforderung (Massimo, WEB_INBOX.md 22.09.,
wörtlich):** "iOS: WKWebView mit deaktiviertem JavaScript und
eingeschraenkter Navigation. Kein direktes Einbetten von Absender-HTML in
den normalen DOM/normale View-Hierarchie." Umgesetzt in der neuen
`Views/MailBodyWebView.swift`:
- **JavaScript deaktiviert:** `WKWebpagePreferences.allowsContentJavaScript
  = false`, gesetzt auf `WKWebViewConfiguration.defaultWebpagePreferences`
  vor `WKWebView`-Erzeugung -- die moderne, seit iOS 15 verfügbare API
  (Deployment-Target dieses Projekts ist iOS 17, siehe
  `project.pbxproj` `IPHONEOS_DEPLOYMENT_TARGET`), kein Bedarf für den
  älteren `WKPreferences.javaScriptEnabled`-Fallback.
- **Eingeschränkte Navigation:** `WKNavigationDelegate.webView(_:
  decidePolicyFor:decisionHandler:)` erlaubt ausschließlich die EINE
  initiale `loadHTMLString`-Ladung (Flag `didFinishInitialLoad`, vor
  `didFinish` immer `false`). Jede Navigation danach -- praktisch immer
  ein Link-Tap, da JS deaktiviert ist und es keine anderen
  Navigationsquellen gibt -- wird abgebrochen (`.cancel`) und stattdessen
  per `UIApplication.shared.open(url)` im System-Browser geöffnet. Da das
  Backend jeden `http(s)`-Link bereits auf
  `${PUBLIC_API_BASE_URL}/link-check?url=...` umschreibt, landet die
  Klick-Zeit-Link-Prüfung dadurch zuverlässig im echten Klick-Fluss, exakt
  wie im Auftrag verlangt ("das ist die fehlende Verbindung, die der
  Klick-Zeit-Pruefung aktuell fehlt").
- **Kein direktes Einbetten in die normale View-Hierarchie:** `bodyHtml`
  geht ausschließlich über `webView.loadHTMLString(_:baseURL: nil)` in die
  isolierte WKWebView-Sandbox -- nirgends wird rohes/sanitisiertes HTML in
  einen nativen `Text`/`AttributedString` konvertiert und direkt in den
  SwiftUI-View-Baum gerendert (siehe `MessageDetail.bodyHtml`-Kommentar in
  `Models/Message.swift`).
- Die vom Backend bereits fertig sanitisierte Server-Antwort wird hier
  NICHT erneut client-seitig gesäubert -- reine Verteidigung durch
  Isolation (Sandbox + kein JS), kein zweiter Sanitizer nötig, analog zur
  Architekturentscheidung in backend/README.md ("Sanitisierung erst beim
  Ausliefern").

**Auto-Sizing ohne JavaScript:** `evaluateJavaScript`-basierte
Höhenmessung scheidet aus (JS ist deaktiviert), aber WKWebView führt auch
mit deaktiviertem JS natives HTML/CSS-Layout durch -- nach
`WKNavigationDelegate.webView(_:didFinish:)` liefert
`webView.scrollView.contentSize.height` bereits die echte gerenderte
Höhe. Diese wird über ein `@Binding<CGFloat>` (gesetzt via
`Coordinator`) an die aufrufende `MailBodyHtmlCard` (private Hilfsview in
`MessageDetailView.swift`) zurückgereicht, die ihre `.frame(height:)`
entsprechend setzt. **Pragmatischer Fallback statt Perfektion** (wie im
Auftrag als akzeptable Vereinfachung genannt): die gemessene Höhe wird auf
120–600pt geklemmt, `webView.scrollView.isScrollEnabled` bleibt dauerhaft
`true` -- falls die Messung zu niedrig ausfällt oder eine Mail ungewöhnlich
lang ist, bleibt der Inhalt über internes Scrollen trotzdem vollständig
erreichbar, statt abgeschnitten zu werden.

**Bewusst NICHT Teil dieses Nachtrags** (wie im Auftrag als "explizit
out of scope" markiert): per-Mail "Bilder trotzdem laden" --
`blockRemoteImages` entfernt blockierte `<img src>` bereits serverseitig,
bevor `MailBodyWebView` das HTML überhaupt sieht; ein blockiertes Bild
zeigt nur noch `alt="Bild blockiert (Tracking-Schutz)"` (kein sichtbares
Retry-UI, kein Endpunkt dafür vorhanden). `MessageDetail.links` wird im
Modell mitgeführt (`Models/Message.swift`, neue `MessageLink`-Struct,
gleiches `Codable`/`decodeIfPresent`-Muster wie `attachments`), aber
bewusst noch OHNE eigenes UI-Element in `MessageDetailView` -- laut
Auftrag "optional/nice-to-have", der Haupt-Fokus war sicheres Rendern von
`bodyHtml`. Reine Text-Mails (`bodyHtml == nil`, unverändert über
`bodyText`) verhalten sich exakt wie vorher, keine Verhaltensänderung.

**Modell-/Mock-Änderungen:**
- `Models/Message.swift`: `MessageDetail.bodyHtml: String?` und
  `MessageDetail.links: [MessageLink]` ergänzt (neue `MessageLink`-Struct:
  `id`, `displayText: String?`, `actualUrl`, `domainMatchesDisplay`,
  `isKnownMalicious`, 1:1 zu `components/schemas/MessageLink` in
  `contracts/api-spec.yaml`). Beide Felder mit Default (`nil`/`[]`) im
  Memberwise-Init und `decodeIfPresent` im `Decodable`-Init, exakt das
  gleiche Muster wie bei `attachments` -- ältere/kleinere JSON-Antworten
  (z.B. `MockAPIClient`s eigener `sendMessage`-Pfad, der weiterhin reinen
  Klartext verschickt) crashen dadurch nicht. `movedTo(folderId:)`/
  `snoozed(until:)` (Copy-Helfer für `MockAPIClient`) geben beide neuen
  Felder unverändert weiter.
- `Networking/MockData/MockDatabase.json`: `msg-007` (die bereits
  existierende PayPal-Phishing-Mock-Mail, auch das `#Preview` in
  `MessageDetailView.swift`) hat jetzt echtes `bodyHtml` (Text-Absatz +
  ein Link, dessen `href` bereits wie vom Backend erwartet auf
  `http://localhost:3000/v1/link-check?url=...` zeigt, Anzeigetext
  `https://www.paypal.com/de/verifizierung` vs. echtes Ziel
  `paypal-verifizierung.example-fake.ru` -- Link-Mismatch analog zu
  Fixture 11 im Backend) sowie ein `<img>` mit leerem `src` +
  `data-blocked-src` (simuliert das Ergebnis der serverseitigen
  Tracking-Pixel-Blockierung) und ein passendes `links`-Array. Alle
  anderen 13 Mock-Nachrichten bleiben reine Text-Mails (`bodyHtml`
  fehlt im JSON, `decodeIfPresent` liefert `nil`).
- `RemoteAPIClient.swift`: keine Änderung nötig -- `fetchMessageDetail`
  dekodiert bereits generisch über `Codable`, die neuen Felder kommen
  automatisch mit durch.

**Xcode-Projekt:** `Views/MailBodyWebView.swift` manuell in
`DriftmailApp.xcodeproj/project.pbxproj` registriert (kein Xcode-GUI in
dieser Umgebung, gleiches Vorgehen wie bei jedem vorherigen Nachtrag
dieser Session mit neuen Dateien -- `PBXBuildFile`/`PBXFileReference`/
`PBXGroup`(Views)/`PBXSourcesBuildPhase` ergänzt, gleiches ID-Schema wie
bestehende Einträge).

**Tests:** `xcodebuild -scheme DriftmailApp -destination 'platform=iOS
Simulator,name=iPhone 17' build` → **BUILD SUCCEEDED**, keine neuen
Compiler-Warnungen (einzige Warnung im Build-Log ist die vorbestehende,
unabhängige `appintentsmetadataprocessor`-Meldung "Metadata extraction
skipped, no AppIntents.framework dependency found"). Verifikation im
Simulator nach dem üblichen Muster dieser Session: sauberer
`simctl uninstall`/`simctl install`/`simctl launch` auf einem gebooteten
Simulator (iPhone 17 Pro), `log show` auf Crash/Fatal/Exception geprüft
-- keine Treffer. Zusätzlich, um das WKWebView-Rendering selbst visuell zu
bestätigen (kein XCUITest-Target vorhanden, siehe unten): `DriftmailApp.swift`
wurde EINMALIG temporär so geändert, dass die App direkt
`NavigationStack { MessageDetailView(messageId: "msg-007") }` mit
`AppEnvironment(previewClient: MockAPIClient(), authenticated: true)`
zeigt (Onboarding-Gate umgangen, gleiches Prinzip wie beim
`AppEnvironment.init()`-Hack im "Neun neue Features"-Nachtrag oben), neu
gebaut, installiert, gestartet und per Screenshot bestätigt: die
sandboxed `MailBodyWebView` rendert den sanitisierten HTML-Body (Text +
den umgeschriebenen, tappable `/link-check`-Link, in eigener weißer
Karte) korrekt und crash-frei -- danach sofort wieder auf den
Original-Code zurückgesetzt (`git diff` vor dem Commit zeigt keine Spur
dieser Änderung, exakt wie beim Vorbild-Nachtrag). Kein XCUITest-Target
vorhanden, daher kein automatisierter Tap auf den Link selbst (dass
`UIApplication.shared.open(url)` bei einem echten Tap greift statt einer
WKWebView-eigenen Navigation, ist damit nur per Code-Review verifiziert,
nicht per Klick-Test) -- dieselbe dokumentierte Grenze wie bei jedem
vorherigen Nachtrag dieser Session ohne UI-Automatisierung.

## Status: gebaut UND im Simulator getestet

Anders als der Auftrag es als Fallback vorsah, war in dieser Umgebung eine
volle Xcode-Installation samt iOS-Simulator-SDKs vorhanden (`xcodebuild`,
`xcrun simctl`). Das Projekt wurde deshalb nicht nur als Quellcode
geliefert, sondern:

- gegen `iphonesimulator` gebaut (`xcodebuild ... -destination 'generic/platform=iOS Simulator' build` → **BUILD SUCCEEDED**),
- auf einem iPhone-17-Pro-Simulator installiert und gestartet,
- per Screenshot verifiziert: Onboarding/Capability-Check, Ordnerliste mit
  Badges/Counts, Quarantäne-Warnung, Nachrichtendetail mit
  Security-Badges — alle rendern korrekt gegen die Mock-Daten.
- Ein Decoding-Bug (siehe unten) wurde dabei live gefunden und gefixt.

Trotzdem: es ist ein erster Durchstich. Kein App-Icon, keine echten Tests
(XCTest-Target), keine Landscape-/iPad-Feinabstimmung, kein Tap-Through
per UI-Test automatisiert (siehe "Was ungetestet ist").

## Öffnen in Xcode

```
open ios/DriftmailApp.xcodeproj
```

Scheme "DriftmailApp" ist als *shared scheme* eingecheckt
(`ios/DriftmailApp.xcodeproj/xcshareddata/xcschemes/DriftmailApp.xcscheme`),
läuft direkt mit ⌘R gegen einen iOS-Simulator. Kein Team/Signing nötig
(`CODE_SIGNING_REQUIRED = NO` für Simulator-Builds).

Kommandozeile:

```
xcodebuild -project ios/DriftmailApp.xcodeproj -scheme DriftmailApp \
  -destination 'generic/platform=iOS Simulator' build
```

Das `.xcodeproj` wurde nicht von Hand in Xcode angelegt, sondern
generiert (Ruby-Gem `xcodeproj`, Script nicht Teil des Repos) — Grund:
keine GUI in dieser Umgebung. Alle Pfade im Projekt sind relativ/
`sourceTree = "<group>"` bzw. `DEVELOPER_DIR`, also portabel. Wer in
Xcode Dateien hinzufügt/entfernt, tut das ganz normal über die IDE; das
Projekt ist danach ein stinknormales Xcode-Projekt.

## Projektstruktur

```
ios/
  DriftmailApp.xcodeproj/
  DriftmailApp/
    App/            — @main App-Struct, AppEnvironment (DI-Container)
    Models/          — Codable-Structs 1:1 zu api-spec.yaml components/schemas
    DesignSystem/    — Swift-Port von contracts/design-tokens.json
    Networking/      — APIClient-Protokoll + MockAPIClient + RemoteAPIClient-Skelett
      MockData/MockDatabase.json — Mock-Antworten passend zur api-spec.yaml
    AI/              — Swift-Port von contracts/ai-adapter-interface.ts
    Security/        — BiometricLock (Face ID/Touch ID App-Sperre, WEB_INBOX.md 15.09.)
    Views/           — Onboarding, Ordnerliste, Inbox, Detail, Quarantäne-Banner, App-Lock-Gate
  README.md          — diese Datei
```

## Kernfluss

1. **Onboarding-Capability-Check** (`Views/OnboardingCapabilityCheckView.swift`):
   läuft einmalig, ruft `CapabilityChecker.check()` auf, meldet das
   Ergebnis über `POST /capability-check` und zeigt an, ob On-Device-KI
   oder Cloud-Fallback aktiv ist.
2. **Ordnerliste** (`Views/FolderListView.swift`): liest `GET /folders`
   (System- und eigene Ordner, zentral gecacht in
   `AppEnvironment.folders`) mit Anzahl pro Ordner (`GET /messages`); ein
   "+"-Button legt über `POST /folders` einen neuen eigenen Ordner an.
3. **Inbox pro Ordner** (`Views/InboxListView.swift`): Nachrichtenliste
   für einen `Folder`; zeigt beim System-Ordner `quarantaene`
   (`folder.systemKey == .quarantaene`) zusätzlich `QuarantineWarningView`
   — Warnbanner in `design-tokens.json`-Dangerfarbe.
4. **Nachrichtendetail** (`Views/MessageDetailView.swift`):
   Security-Badges (SPF/DKIM/DMARC, Homoglyph, Link-Mismatch, neue IBAN,
   Konfidenz), Body-Text, Buttons "Was wollen die von mir?"
   (`GET /messages/{id}/summary`) und "Antwortentwurf"
   (`POST /messages/{id}/reply-draft`), ein "Verschieben nach…"-Menü über
   alle Ordner (`POST /messages/{id}/move`), sowie — außer im
   Quarantäne-Ordner selbst — "In Quarantäne verschieben"
   (`POST /messages/{id}/quarantine`); dazu "Löschen"
   (`DELETE /messages/{id}`, verschiebt in den Papierkorb) bzw. im
   Papierkorb selbst "Endgültig löschen"
   (`DELETE /messages/{id}/permanent`, mit Bestätigungsdialog).

## Was ist gemockt / stubbed

- **Backend**: `Networking/MockAPIClient.swift` lädt
  `Networking/MockData/MockDatabase.json` (6 System-Ordner inkl.
  Papierkorb + 1 eigener Beispiel-Ordner "Familie", 13 Nachrichten
  verteilt über alle 7 Ordner, 2 Verträge, 3 vorberechnete
  Zusammenfassungen, 1 Mail-Account) und
  bedient daraus alle Endpunkte aus `api-spec.yaml`, inklusive
  simulierter Netzwerklatenz und einfacher In-Memory-Validierung für die
  Ordner-Endpunkte (Umbenennen von `quarantaene`/`spam` wird abgelehnt
  — `APIError.forbidden` —, System-Ordner sind nicht löschbar, Nachrichten
  eines gelöschten Ordners wandern nach "Sonstiges").
  `Networking/RemoteAPIClient.swift` ist ein Skelett gegen
  `https://api.driftware.online/v1` (URLSession, alle Pfade inkl. der
  neuen Ordner-Endpunkte aus der Spec verdrahtet), aber ungetestet —
  Track A hat noch kein Backend, und die serverseitige Validierung
  (welche Umbenennungen/Löschungen erlaubt sind) ist dort nicht
  nachgebildet, nur clientseitig im Mock. Umschalten:
  `AppEnvironment.init(apiClient:)` in `App/AppEnvironment.swift`.
- **On-Device-KI**: `AI/OnDeviceAiAdapter.swift` implementiert das
  `AiAdapter`-Protokoll (1:1 Port von `ai-adapter-interface.ts`) mit
  simplen Keyword-/Heuristik-Checks (z. B. Dringlichkeits-Wörter,
  Homoglyph-Stichproben, "IBAN"+"neue" für `containsNewIban`), kein
  echtes ML-Modell. `AI/CapabilityChecker.swift` prüft nur grob
  Geräte-Modell-Präfix (`iPhone`/`iPad`) — kein echter Test auf
  Modell-Runtime-Verfügbarkeit. `CloudFallbackAiAdapter` liefert
  Kanned-Antworten für den Fallback-Pfad.
- **Vertragsdaten-Extraktion**: `extractContract` in
  `OnDeviceAiAdapter` ist ein Platzhalter, der absichtlich niedrige
  `extractedConfidence` liefert, damit der UI-Review-Pfad testbar bleibt
  — keine echte Datumsextraktion.

## Was ungetestet ist

- **Kein XCTest/XCUITest-Target.** Verifiziert wurde stattdessen manuell:
  Build gegen `iphonesimulator` + Installation/Start auf einem
  iPhone-17-Pro-Simulator + Screenshots der vier Kernscreens
  (Onboarding, Ordnerliste, Quarantäne-Inbox, Nachrichtendetail) mit
  echten Mock-Daten. Tap-Interaktionen (Navigation durch Taps, Buttons)
  konnten in dieser Umgebung nicht zuverlässig automatisiert geprüft
  werden — `osascript`/System Events lief zwar ohne Berechtigungsfehler,
  Klick-Koordinaten trafen aber nicht zuverlässig die richtige View (kein
  Mapping von Screenshot-Pixeln auf Fenster-Punkte verfügbar), und kein
  XCUITest-Target wurde aufgesetzt. Screens wurden stattdessen einzeln
  temporär als Root-View geswitcht (`App/DriftmailApp.swift`), gebaut,
  installiert, gestartet und gescreenshottet — danach jedes Mal sauber
  zurückgesetzt (siehe `git diff` vor dem Commit).
- `RemoteAPIClient` ist reiner Zeilencode, nie gegen einen echten Server
  gelaufen (es gibt noch keinen). Das gilt jetzt auch für die neuen
  Ordner-Endpunkte (`GET/POST /folders`, `PATCH/DELETE /folders/{id}`,
  `POST /messages/{id}/move`).
- Die neue **Ordner-UI ist bewusst minimal**: Anlegen (Name via Alert/
  `TextField`, Icon fest auf `customFolder.defaultIcon`) und Verschieben
  gehen, aber Umbenennen und Löschen eines Ordners haben noch keine UI
  (nur `APIClient`/`MockAPIClient` decken die Endpunkte ab) — Reihenfolge
  ändern (`sortOrder` per Drag) ebenfalls nicht. Das war aus Zeitgründen
  außerhalb des Kernauftrags ("Modelle, Mock-Daten, Navigation,
  APIClient anpassen") zurückgestellt.
- Dark Mode / Dynamic Type / iPad-Layout nicht separat geprüft (Farben
  sind aber via `Color(light:dark:)` dynamisch angelegt, sollten
  funktionieren).
- Kein App-Icon, kein Launch-Screen-Asset (nutzt
  `GENERATE_INFOPLIST_FILE`/`INFOPLIST_KEY_UILaunchScreen_Generation` für
  einen Blanko-Launch-Screen).
- Reale On-Device-Modell-Integration (Core ML o. ä.) fehlt komplett —
  war laut Auftrag optional/mocked.

## Annahmen

- **Bundle-ID**: `online.driftware.driftmail` (an die in `api-spec.yaml`
  genannte Domain `api.driftware.online` angelehnt) — nicht mit Track A
  abgestimmt, reine Annahme für dieses Grundgerüst.
- **Deployment Target**: iOS 17.0 — moderner genug für `NavigationStack`,
  Swift Concurrency (`async`/`await`, `actor`), ohne auf die aktuellste
  SDK-Version zu pinnen.
- **IDs als `String`, nicht `UUID`**: `api-spec.yaml` sagt
  `format: uuid`, aber die Modelle nutzen `String`. Grund: Mock-Daten
  brauchen keine echten UUIDs, und Decodierfehler durch strikte
  UUID-Validierung wollte ich in diesem ersten Durchstich vermeiden.
  Track A sollte tatsächliche UUIDs liefern; `String` dekodiert die auch
  klaglos.
- **Datumsformate**: `api-spec.yaml` mischt `format: date-time`
  (`receivedAt`) und `format: date` (`contractEnd`,
  `MailSummary.deadline`, etc.). `Networking/DateDecoding.swift`
  versucht beim Decodieren zuerst volles ISO-8601-Datetime, dann
  `yyyy-MM-dd` — das ist eine Annahme über das reale Backend-Format, die
  mit Track A verifiziert werden sollte (siehe "Offene Fragen" in
  SYNC.md).
- **`AiAdapterResult<T>`** aus `ai-adapter-interface.ts` wird als eigener
  Swift-Typ geführt (`AI/AiAdapter.swift`), aber im MockAPIClient nicht
  durchgängig verwendet — die Mock-Antworten tragen die Quelle direkt im
  `MailSummary.source`-Feld statt im Wrapper. Für echte On-Device-Aufrufe
  sollte der Wrapper konsequent genutzt werden.
- **Kein Settings-Screen**: der Capability-Check läuft nur einmal
  (`@AppStorage("hasCompletedOnboarding")`); es gibt keinen Weg, ihn aus
  der App heraus erneut auszulösen. Für einen echten Release bräuchte es
  einen Settings-Screen dafür.
- **`Folder.isRenamable`/`.isDeletable` sind Client-seitige Ableitungen**
  aus `systemKey` (nur `quarantaene`/`spam` gesperrt, alles andere
  erlaubt), nicht aus einem eigenen API-Feld — `api-spec.yaml` liefert
  kein `renamable`/`deletable` auf `Folder` selbst, nur implizit über die
  Endpunkt-Beschreibungen. `MockAPIClient` setzt das serverseitig als
  `APIError.forbidden` durch; ob Track A dieselbe Regel exakt so umsetzt
  (z. B. Fehlercode/-format bei einem verbotenen Rename), ist unverifiziert.
- **`AppEnvironment.folders` wird einmalig gecacht** (nicht bei jeder
  View neu geladen) und nach Mutationen (Ordner anlegen, Nachricht
  verschieben) manuell mit `forceRefresh: true` neu geholt. Kein
  Realtime-Sync zwischen mehreren offenen Screens — für dieses
  Grundgerüst ausreichend, für eine Mehrfenster-/Mehrgeräte-Situation
  später zu prüfen.

## [2026-09-25] BUG behoben: "iOS erreicht lokales Backend nicht" (WEB_INBOX.md 21.09.) -- keine ATS-/Netzwerk-Eigenheit, echter Decoding-Bug

Massimo hatte im Simulator `DRIFTMAIL_API_BASE_URL=http://localhost:3000/v1`
gesetzt, Backend lief nachweislich -- trotzdem zeigte
`OnboardingAccountConnectView` weiterhin "Anbieterliste konnte nicht live
geladen werden" UND ein IMAP-Verbindungsversuch (web.de) schlug fehl.
Verdacht laut Auftrag: App Transport Security blockiert Klartext-HTTP zu
localhost. Bereits der 21.09.-Eintrag oben ("Onboarding: Provider-Auswahl")
hatte dasselbe Symptom gegen `SIMCTL_CHILD_DRIFTMAIL_API_BASE_URL`
beobachtet und es als "vermutlich eine Simulator-/Xcode-27-spezifische
Netzwerk-Eigenheit" eingeordnet -- **diese Einordnung war falsch**, wie
sich jetzt zeigt.

**Reproduziert mit echtem Simulator-Build + Netzwerk-Log, nicht nur
Info.plist-Diff:**

1. `plutil -p` auf das TATSAECHLICH gebaute `Info.plist`
   (`/tmp/driftmail-build/.../DriftmailApp.app/Info.plist`) zeigt
   `NSAppTransportSecurity.NSAllowsLocalNetworking = true` korrekt gesetzt
   -- der 21.09.-Fund ("Build-Setting wird still ignoriert, jetzt echte
   Datei") ist also weiterhin gültig gefixt, ATS ist NICHT die Ursache.
2. `loadProviders()` in `OnboardingAccountConnectView.swift` verschluckte
   den echten Fehler komplett (`catch { providersLoadFailed = true }`,
   keinerlei Logging) -- ATS-Verdacht beruhte allein auf dem sichtbaren
   Symptom, nie auf dem tatsächlichen `Error`-Wert. Temporär ein `print()`
   in den `catch`-Zweig eingefügt, per `xcrun simctl launch --console-pty`
   (mit `SIMCTL_CHILD_DRIFTMAIL_API_BASE_URL=http://localhost:3000/v1`)
   gegen den echten `backend/`-Prozess ausgeführt und die Konsolenausgabe
   abgefangen -- das ist der Teil, der beim 21.09.-Versuch fehlte.
3. Echter Fehler: `DecodingError.keyNotFound("requiresAppPassword")` beim
   ersten Array-Element. Ursache: `contracts/mail-providers.json` lässt
   `imapHost`/…/`requiresAppPassword`/`appPasswordHelpUrl` für
   `authType=oauth`-Einträge (Gmail/Outlook/Yahoo) komplett weg (siehe die
   Datei selbst), aber `Models/MailProvider.swift` deklarierte
   `requiresAppPassword: Bool` als Pflichtfeld ohne Sonderbehandlung.
   Swifts synthetisiertes `Decodable` wirft dadurch für die Gmail-Zeile
   (erstes Element), und ein einzelner Decoding-Fehler verwirft laut
   `JSONDecoder`-Semantik das GESAMTE Array, nicht nur den betroffenen
   Eintrag -- **das Backend war zu jedem Zeitpunkt erreichbar, ATS/Netzwerk
   nie das Problem**, jeder einzelne `GET /mail-providers`-Aufruf gegen den
   echten Server scheiterte stattdessen an dieser einen fehlenden
   Optional-Behandlung.

**Fix (`Models/MailProvider.swift`):** eigener `init(from decoder:)` statt
der synthetisierten Decodable-Implementierung -- alle bereits als
`String?`/`Int?`/`Bool?` deklarierten Felder nutzen weiterhin
`decodeIfPresent` (unverändertes Verhalten), `requiresAppPassword` bleibt
bewusst ein nicht-optionales `Bool` in der Swift-API (beide Call-Sites in
`OnboardingAccountConnectView.swift` nutzen es als klares Ja/Nein), wird
aber jetzt per `decodeIfPresent(...) ?? false` gelesen -- fehlt der
Schlüssel (oauth-Provider), gilt `false`, exakt die Bedeutung, die die
sechs bereits eingecheckten `MailProvider.mocked`-Fixtures für Gmail/
Outlook/Yahoo ohnehin schon fest verdrahtet hatten (`requiresAppPassword:
false`) -- der Fix bringt den Live-Pfad also in Deckung mit dem Mock-Pfad,
keine neue Semantik erfunden.

**Zweites Symptom aus dem Auftrag ("IMAP-Verbindungsversuch schlägt
ebenfalls fehl") eingeordnet, nicht separat gefixt:** `POST /accounts`
gegen den echten `backend/`-Prozess mit absichtlich falschem Passwort
(`curl`, gleicher Endpunkt wie `RemoteAPIClient.connectImapAccount`/
`connectPop3Account`) liefert korrekt `422` mit einer sprechenden
Fehlermeldung -- Verbindung/ATS funktionieren auch hier einwandfrei, kein
zweiter Bug. `RemoteAPIClient` wertet `422` bereits explizit als
`APIError.verificationFailed` aus (eigener catch-Zweig in
`OnboardingAccountConnectView.swift`, keine generische Netzwerkfehler-
Meldung). Das von Massimo beobachtete Fehlschlagen war damit sehr
wahrscheinlich eine echte Zugangsdaten-/App-Passwort-Verwechslung beim
Testen mit einem echten web.de-Konto, kein App-Bug -- bitte beim nächsten
Test mit einem web.de-App-Passwort (nicht dem normalen Kontopasswort)
gegenprüfen, jetzt wo die Anbieterliste wieder live lädt.

**Verifiziert:** `xcodebuild -destination 'platform=iOS Simulator,name=iPhone
17 Pro' build` **BUILD SUCCEEDED**, App per `simctl install`+`simctl launch`
(mit `SIMCTL_CHILD_DRIFTMAIL_API_BASE_URL` gegen den echten laufenden
`backend/`-Prozess) auf einem echten Simulator gestartet, Konsolenausgabe
zeigt nach dem Fix keinen Decoding-Fehler mehr, Screenshot bestätigt: kein
"Anbieterliste konnte nicht live geladen werden"-Hinweis mehr sichtbar,
alle 7 Provider erscheinen wie beim Mock (Gmail/iCloud/GMX/web.de/Anderer
Anbieter anwählbar, Outlook/Yahoo ausgegraut "demnächst").

## [2026-09-25] Nachtrag: Anbieter automatisch aus E-Mail-Adresse erkennen (WEB_INBOX.md 21.09.)

Bisher fragte `OnboardingAccountConnectView` zuerst nach dem Anbieter
(Liste), erst danach nach der E-Mail-Adresse -- unnötiger Extra-Schritt,
da der User die Adresse ohnehin eingeben muss. Umgedreht:

- **Contract-Ergänzung** (`contracts/mail-providers.json` +
  `api-spec.yaml` `MailProvider.domains`): jeder Provider trägt jetzt eine
  Liste seiner Domains in Kleinbuchstaben (z. B. `gmx: ["gmx.de", "gmx.net",
  "gmx.at", "gmx.ch"]`), `other_imap` bewusst leer (Fallback für jede nicht
  erkannte Domain). Reine Datenergänzung, `backend/src/routes/
  mailProviders.ts` liefert die Datei ohnehin unverändert aus -- kein
  Backend-Code-Change nötig.
- **`Models/MailProvider.swift`**: `domains: [String]` ergänzt, mit
  derselben `decodeIfPresent(...) ?? []`-Vorsicht wie bei
  `requiresAppPassword` (siehe Nachtrag oben) -- auch wenn die aktuelle
  Contract-Datei das Feld für jeden Eintrag mitgibt, soll ein zukünftig
  fehlendes Feld nicht wieder die gesamte Liste zum Absturz bringen.
- **`Views/OnboardingAccountConnectView.swift`** komplett umgebaut: neuer
  erster Schritt `.enterEmail` (ein `TextField` + "Weiter"), matcht die
  eingegebene Adresse nach dem "@" gegen `MailProvider.domains` (exakter
  Domain-Vergleich, kein Teilstring-Match -- `not-gmail.com` matcht nicht
  auf Gmail). Drei Fälle:
  1. Bekannte, nutzbare Domain (iCloud/GMX/web.de) -> direkt weiter zu
     `.imapForm(provider, initialEmail:)` -- die Adresse wird
     durchgereicht, kein erneutes Eintippen.
  2. Bekannte, aber (noch) nicht nutzbare Domain (Gmail: oauth, auf iOS
     ohnehin nicht funktional; Outlook/Yahoo: `comingSoon`) -> Hinweis-
     Alert mit Erklärung UND einem "Trotzdem per IMAP versuchen"-Button,
     der in denselben generischen IMAP-Fallback springt wie Fall 3 -- keine
     Sackgasse, wie im Auftrag gefordert.
  3. Unbekannte Domain -> direkt (ohne Fehlermeldung) zu `other_imap` mit
     vorbefüllter Adresse, manuelle Servereingabe wie bisher.
  Der bisherige listenbasierte Auswahlbildschirm ist NICHT entfernt,
  sondern als sekundärer, manueller Weg erhalten
  (`.pickProviderManually`, über einen "Anbieter manuell auswählen"-Link
  erreichbar) -- für Korrekturen einer Fehlerkennung oder um bewusst ein
  anderes Preset zu testen, ohne eine bereits funktionierende Möglichkeit
  zu streichen.
- **`ImapConnectFormView`** bekommt einen neuen `initialEmail`-Parameter
  (Default `""`, damit der bestehende manuelle Weg über den Picker
  weiterhin ohne vorbefüllte Adresse funktioniert).
- **Web-Seite (Track F) nicht Teil dieser Änderung** -- der Auftrag betrifft
  laut WEB_INBOX.md "Web und iOS gleichermaßen", dieser Nachtrag deckt nur
  den iOS-Teil + die gemeinsame Contract-Datei ab. `web/src/components/
  OnboardingScreen.tsx` müsste denselben `domains`-Abgleich noch bekommen.

**Tests:** `xcodebuild -destination 'platform=iOS Simulator,name=iPhone 17
Pro' build` **BUILD SUCCEEDED**, App per `simctl install`+`launch` gegen den
echten `backend/`-Prozess gestartet, neuer Eingabebildschirm per Screenshot
verifiziert. Die drei Domain-Matching-Fälle selbst sind NICHT per
Tap-Interaktion durchgeklickt (gleiche Werkzeug-Grenze wie in allen
vorherigen iOS-Einträgen: kein `idb`, keine automatisierten
Texteingaben/Taps im Simulator in dieser Umgebung) -- die Matching-Logik
selbst ist reiner, von der UI entkoppelter Code
(`matchedProvider(for:)`) und wurde stattdessen durch Code-Review + die
bereits gegen den echten Server verifizierten `GET /mail-providers`-Daten
(inkl. `domains`-Feld) abgesichert, ehrlich so dokumentiert statt ein
End-to-End-Ergebnis zu behaupten, das in dieser Umgebung nicht geprüft
werden konnte.

## [2026-09-25] Nachtrag: Neue Design-Richtung "Outlook-inspiriert" (WEB_INBOX.md 24.09./25.09.) -- Farben, Radien, Ordner-Icons

WEB_INBOX.md 24.09. "DESIGN-RICHTUNG PRAEZISIERT - Outlook-inspiriert"
(ersetzt den kurz zuvor verworfenen "Kobaltblau"-Entwurf) + "ORDNER-ICONS
- 3D/Facetten-Stil" + 25.09. "GESENDET-ICON - finale Referenz erhalten".
Umfang laut Auftrag selbst eingeteilt: das Drei-Spalten-Layout ist eine
Web-Grundlayout-Aenderung (Track F) und NICHT Teil dieses Nachtrags --
iOS behaelt den bestehenden Navigations-Stack, wie im Auftrag selbst als
plausibel vorgezeichnet ("Drei-Spalten auf dem iPhone nicht sinnvoll").
Dieser Nachtrag deckt Contract + iOS-Farben/Radien/Icons ab.

**`contracts/design-tokens.json`:**
- `color.accent` von Teal (`#1D9E75`) auf Microsoft-Blau (`#0078D4`)
  umgestellt, neuer Eintrag `outlook_blue` in `accentThemes` als neuer
  Default -- `teal` bleibt als waehlbare Alternative bestehen (kein Nutzer
  verliert eine bereits getroffene Wahl, siehe `_accentThemesNote`).
- `color.danger`/`dangerText` auf `#A4262C` + neuer `dangerBg` (`#FDE7E9`)
  fuer die "Pruefen"-Badges -- `warning`/`success` bewusst UNVERAENDERT
  gelassen (vom Auftrag nicht erwaehnt, das waren nur Icon-Palette-Werte
  fuer die Quarantaene-GRAFIK, nicht der semantische Warnfarben-Token).
- Neuer `color.selected` (Hintergrund/Text der aktiven Zeile/des aktiven
  Ordners, `#DEECF9`/`#004578`) -- Outlook nutzt hier einen eigenen Ton
  statt einer transparenten Akzentflaeche.
- `color.light.*` auf die Outlook/Fluent-Palette umgestellt (reines Weiss,
  abgesetzte Karten/Ordner-Leiste `#FAF9F8`, neue `borderSubtle` fuer
  dezentere Listentrenner). `color.dark` bewusst unveraendert (Auftrag
  spezifiziert nur hell).
- `typography.fontFamilyWeb` neu ("Segoe UI" mit System-Fallback, nur fuer
  Web) -- iOS bleibt bei SF Pro (System-Schrift), wie im Auftrag
  ausdruecklich als ausreichend bestaetigt ("Ziel ist der Fluent-
  Charakter, nicht Pixel-Kopie").
- `radius.control`/`radius.card` von 8/12 auf 4 reduziert ("dezente
  Rundung, keine starken Schatten").
- Neuer `systemFolders.facetIconStyle`-Block: Motiv-Beschreibung + die
  drei Facetten-Farbtoene (base/light/dark) je Icon (Eingang/Gesendet/
  Quarantaene/Papierkorb) plus die gemeinsame Boden-Schatten-Ellipsen-
  Farbe -- gemeinsame Referenz fuer Web+iOS, damit beide Plattformen aus
  denselben Werten bauen statt das Chat-Mockup je einzeln nachzumessen.

**Backend (`accent_theme`-Default, noetig weil der neue Akzent auch der
neue Standard fuer neue Konten ist, nicht nur eine weitere Wahlmoeglichkeit):**
- `contracts/db-schema.sql`: `CREATE TABLE users` DEFAULT + CHECK auf
  `outlook_blue` erweitert/umgestellt (frische DBs).
- `backend/src/db/postgresStore.ts` `migrateUsersAccentTheme()`: fuer
  bereits migrierte DBs (wo die additive `ADD COLUMN IF NOT EXISTS` nicht
  mehr greift) ein DROP/ADD-CONSTRAINT + `ALTER COLUMN ... SET DEFAULT`
  ergaenzt, gleiches Muster wie die bestehende
  `migrateUnsubscribeActionsStatusCheck`-Migration. Gegen die echte
  laufende Demo-Postgres-DB verifiziert (`pg_constraint`-Abfrage vor/nach,
  Test-Insert eines neuen Users zeigt `outlook_blue`) -- bestehende
  Nutzer (z.B. der Demo-Account) behalten ihre gespeicherte Wahl
  (`teal`), nur NEUE Zeilen bekommen den neuen Default. `src/types.ts`,
  `src/routes/settings.ts` (`VALID_ACCENT_THEMES`), `src/db/store.ts`
  (In-Memory-Store-Default) und `src/smoketest.ts` (Default-Assertion)
  entsprechend mitgezogen. `npm run typecheck` sauber; `npm test`
  (Smoketest) bricht an einer davon UNABHAENGIGEN Stelle ab (fehlender
  lokaler ClamAV-Daemon fuer den Anhang-Scan-Test, Umgebungslimitation,
  kein Code-Fehler) -- die accentTheme-Assertion selbst wurde deshalb nicht
  vom Smoketest-Lauf bestaetigt, sondern direkt per SQL/curl gegenverifiziert
  (siehe oben), ehrlich so vermerkt statt "Tests gruen" zu behaupten.

**iOS:**
- `DesignSystem/DesignTokens.swift`: alle obigen Farb-/Radius-Werte 1:1
  gespiegelt (`accent`, `danger`/`dangerBg`/`dangerText`,
  `selectedBackground`/`selectedText`, `surfacePage`/`surfaceCard`/
  `textPrimary`/`textSecondary`/`textMuted`/`border`/`borderSubtle`,
  `Radius.control`/`.card`). `selectedBackground`/`selectedText` sind neu
  angelegt, aber noch NICHT verdrahtet (keine bestehende View nutzt bisher
  ein eigenes "ausgewaehlte Zeile"-Farbpaar statt Akzent-mit-Opacity) --
  bewusst nur als Token vorbereitet, Verdrahtung waere ein eigener,
  groesserer UI-Umbau pro Liste und war nicht Teil dieses Nachtrags.
- `Models/UserSettings.swift`: `AccentTheme.outlookBlue` (`"outlook_blue"`)
  neu, als erster Fall (Default-Charakter), `MockAPIClient`s
  Default-`UserSettings` darauf umgestellt.
- **Vier neue Ordner-Icons** (`Assets.xcassets/FolderIcon{Eingang,
  Gesendet,Quarantaene,Papierkorb}.imageset`, je 1x/2x/3x-PNG): eigene
  SVG-Nachbauten nach der `facetIconStyle`-Spezifikation (flache
  Farbflaechen statt Gradient, Boden-Schatten-Ellipse), gerendert per
  Headless-Chrome-Screenshot + `sips`-Skalierung (gleiche Methode wie
  beim App-Icon-Nachtrag, siehe oben). `Models/Folder.swift`:
  `facetIconAssetName`-Computed-Property mappt die vier betroffenen
  Icon-Keys auf die Asset-Namen, alle anderen (Entwürfe/Sonstiges/Spam/
  eigene Ordner) bleiben unveraendert einfarbige SF Symbole -- dafuer gab
  es keine Facetten-Vorgabe. `Views/FolderListView.swift`s `FolderRow`
  nutzt das Asset statt `Image(systemName:)`, wenn vorhanden (kein
  `.foregroundStyle` mehr fuer diese vier, die Grafik bringt ihre Farbe
  schon mit) -- die bisherige "genau EIN Akzent pro Zeile"-Neutralitaetsregel
  gilt fuer die uebrigen Icons unveraendert weiter.
- **Bewusste Grenze:** die `ContentUnavailableCompat(systemImage:)`- und
  `Label(systemImage:)`-Aufrufe in `InboxListView.swift`/
  `DraftListView.swift`/`MessageDetailView.swift` (Leerzustand-Icon bzw.
  "Verschieben nach…"-Menü) nutzen weiterhin `folder.systemImage` (SF
  Symbol) statt der neuen Facetten-Grafik -- beide APIs nehmen nur einen
  Symbol-Namen entgegen, kein beliebiges Bild; ein Umbau auf eigene
  Icon-Views waere ein groesserer, hier nicht angemessener Eingriff fuer
  zwei sekundaere Stellen (Leerzustand, Menüzeile). Hauptsächliche
  Sichtbarkeit (Sidebar-Ordnerliste) ist abgedeckt.

**Tests/Verifikation:** `xcodebuild -destination 'platform=iOS
Simulator,name=iPhone 17 Pro' build` **BUILD SUCCEEDED**. Neu installiert
und gestartet (frischer Bundle-State, kein Keychain-Token) -- Onboarding-
Bildschirm per Screenshot bestaetigt: reines Weiss statt Creme, Icon/Link
in neuem Microsoft-Blau statt Teal. Die vier Facetten-Icons wurden
EINZELN vor dem Einbau als PNG gerendert und visuell gegen die Spec
geprueft (Eingang: blauer Umschlag mit hellerer Flap + zwei dunkleren
Seiten; Quarantaene: Amber-Warndreieck mit dunklerem Ausrufezeichen;
Papierkorb: konischer Korb mit sichtbaren Gitterstaeben, keine eckige
Tonne; Gesendet: blauer Papierflieger nach oben-rechts mit hellerem
Fluegel/dunklerer Unterseite) -- siehe Screenshots im Session-Verlauf.
**Nicht verifiziert:** die zusammengesetzte Ordnerliste selbst (alle vier
Icons gemeinsam im echten `FolderListView`-Kontext, mit den neuen
Zeilenfarben) liess sich in dieser Umgebung nicht screenshotten -- das
erfordert entweder einen echten verbundenen Mail-Account (keine
Testzugangsdaten verfuegbar) oder Tap-Interaktion durch das Onboarding
(keine UI-Automation in dieser Umgebung, gleiche Werkzeug-Grenze wie in
allen vorherigen iOS-Eintraegen). Empfehlung fuer die naechste Sitzung
mit echtem Xcode-/Geraete-Zugriff: einmal durchs Onboarding klicken und
die Ordnerliste gegenpruefen, bevor dieser Nachtrag als vollstaendig
bestaetigt gilt.

## Nächste Schritte (nicht Teil dieses Durchstichs)

- Ordner umbenennen/löschen/neu sortieren in der UI (Endpunkte sind da,
  UI noch nicht).
- XCUITest-Target für automatisierte Navigationstests.
- Echtes On-Device-Modell hinter `AiAdapter` (Core ML/Apple Intelligence,
  sobald verfügbar).
- `RemoteAPIClient` gegen echtes Track-A-Backend verifizieren, sobald
  vorhanden.
- App-Icon, Launch-Screen-Design nach `design-tokens.json`.
- Undo/Snackbar nach "Löschen" (in den Papierkorb), analog Gmail — bisher
  nicht Teil des Contracts.
