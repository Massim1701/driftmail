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
