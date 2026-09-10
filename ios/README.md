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
    Views/           — Onboarding, Ordnerliste, Inbox, Detail, Quarantäne-Banner
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
