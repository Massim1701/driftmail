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
   (`POST /messages/{id}/quarantine`).

## Was ist gemockt / stubbed

- **Backend**: `Networking/MockAPIClient.swift` lädt
  `Networking/MockData/MockDatabase.json` (5 System-Ordner + 1 eigener
  Beispiel-Ordner "Familie", 11 Nachrichten verteilt über alle 6 Ordner,
  2 Verträge, 3 vorberechnete Zusammenfassungen, 1 Mail-Account) und
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
