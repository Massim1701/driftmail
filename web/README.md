# driftmail — Web-Fallback-UI (Track F)

Web-App-Shell für driftmail: Inbox mit den Ordnern des Users (7 feste
System-Ordner + beliebig viele eigene Ordner, aus `GET /folders`),
Nachrichtenansicht mit Security-Badge, Quarantäne-Ansicht, echtem
Mail-Versand inkl. Anhängen und Entwürfen. Gestylt nach den Design-Tokens
(Farben, Typografie, Radius, Spacing), inkl. Light-/Dark-/System-Theme.

Dies ist ein erster Durchstich (Skeleton), kein produktionsreifer Code.
Ziel: Kernfluss end-to-end zeigen, gegen denselben Mock-Server-Vertrag
wie Track C (iOS) arbeiten.

**Update 08.09. (Contract-Änderung "benutzerdefinierte Ordner", Commit
`734781e`):** Der feste 5er-Folder-Enum wurde durch echte `Folder`-Objekte
({id, name, icon, isSystem, systemKey, sortOrder}) ersetzt. Details im
Abschnitt "Ordner" weiter unten sowie in `SYNC.md` unter
"Contract-Änderungen".

**Update 10.09. (Senden-Endpunkt + Anhänge + Ordner-Umbau, WEB_INBOX.md
09.09.):** `POST /messages/send` (echter Versand statt deaktiviertem
Button), `POST /attachments` (Anhang-Upload/Scan vor dem Senden), neue
Standard-Ordner `eingang`/`entwuerfe`/`gesendet` ersetzen
`wichtig`/`rechnungen`. Details in den Abschnitten "Versand & Anhänge" und
"Ordner-Umbau" weiter unten.

## Stack

- Vite + React + TypeScript (`npm create vite@latest -- --template react-ts`)
- Kein UI-Framework/Component-Library — alle Styles sind eigene CSS-Dateien,
  die ausschließlich die CSS-Variablen aus `src/tokens.css` benutzen
  (1:1 aus `contracts/design-tokens.json`).
- Mock-Server: reines Node (`node:http`), keine externe Abhängigkeit —
  liefert Beispieldaten exakt in der Form aus `contracts/api-spec.yaml`.

## Starten

Zwei Terminals (oder `npm run dev:all`, siehe unten):

```bash
cd web
npm install

# Terminal 1: Mock-Server (Port 4000)
npm run mock

# Terminal 2: Vite-Dev-Server (Port 5173)
npm run dev
```

Dann `http://localhost:5173` öffnen. Der Client erwartet den Mock-Server
standardmäßig auf `http://localhost:4000` (überschreibbar über
`VITE_API_BASE_URL`, siehe `.env.example`).

Alternativ beide Prozesse in einem Terminal starten:

```bash
npm run dev:all
```

(startet Mock-Server und Vite parallel über die Node-eigene
`--run`-Kombination in `package.json`; `Ctrl+C` beendet beide.)

### Build

```bash
npm run build     # tsc -b && vite build -> dist/
npm run lint       # oxlint
```

## Was ist gemockt

- **Backend komplett gemockt.** `mock-server/server.mjs` implementiert alle
  Endpunkte aus `contracts/api-spec.yaml` (`/accounts` (GET + POST),
  `/folders`, `/folders/{folderId}`, `/messages`, `/messages/{id}` (GET +
  DELETE), `/messages/{id}/permanent` (DELETE), `/messages/{id}/quarantine`,
  `/messages/{id}/unsubscribe`, `/messages/{id}/move`,
  `/messages/{id}/summary`, `/messages/{id}/reply-draft`, `/messages/send`,
  `/attachments`, `/drafts` (GET/POST), `/drafts/{id}` (PATCH/DELETE),
  `/contracts`, `/contracts/{id}/confirm`, `/capability-check`) gegen
  statische Beispieldaten in `mock-server/data.mjs`. Mutationen (Ordner
  anlegen/umbenennen/löschen, Nachricht verschieben/löschen/in Quarantäne
  setzen, Contract bestätigen, Anhänge/Entwürfe) wirken nur im
  Prozessspeicher und gehen beim Neustart verloren.
- **KI-Quelle ist immer `cloud_fallback`.** Laut Auftrag nutzt Web keine
  On-Device-KI (kein Browser-seitiges Modell). Der Mock-Server liefert in
  `MailSummary.source` konsequent `"cloud_fallback"`. Für
  `AiAdapterResult` aus `contracts/ai-adapter-interface.ts` gilt web-seitig
  dieselbe Annahme (die Interface-Datei selbst wird von Track A/B/D real
  implementiert, hier nur konsumiert).
- **Mailversand ist echt verdrahtet** (Nachtrag 10.09., WEB_INBOX.md
  09.09. "Fehlender Senden-Endpunkt"): der "Senden"-Button ruft
  `POST /messages/send` auf, siehe Abschnitt "Versand & Anhänge" unten.
  Der Mock-Server selbst hat weiterhin kein echtes Postfach dahinter
  (simulierter Erfolg, analog zum Fixture-Adapter im echten Backend).
- ~~**Keine echte Authentifizierung/Login-UI.**~~ **Nachgezogen (10.09.,
  siehe `backend/README.md` "Echter Google-Login"):** echter LoginScreen
  (`src/components/LoginScreen.tsx`), Token wird explizit in `localStorage`
  gehalten (`src/api.ts`), keine implizite Demo-Anmeldung mehr. Button
  navigiert per echtem Browser-Redirect zu `GET /auth/google/start`. Der
  Mock-Server implementiert dieses eine GET als sofortigen Redirect zu
  `/auth/callback?token=mock-server-token` (kein echtes Google nötig für
  lokale UI-Entwicklung, prüft den Token danach weiterhin NIE) — derselbe
  Client-Code läuft damit unverändert gegen Mock- und echtes Backend. Es
  gibt weiterhin genau ein Mock-Konto (`massimo@example.com`, Provider
  `gmail`).
- **Kein echtes IMAP/OAuth**, kein echter Datenbank-Layer — `db-schema.sql`
  wird nicht direkt verwendet, nur als Referenz für plausible Beispieldaten
  (z. B. Feldnamen der `quarantine`-Tabelle für den simulierten
  Quarantäne-Eintrag).

## UI-Aufbau

- **Sidebar (links):** lädt ihre Ordnerliste jetzt zur Laufzeit über
  `GET /folders` (System- + eigene Ordner, sortiert nach `sortOrder`) statt
  einer festen 5er-Liste aus `design-tokens.json`. Pro Ordner Icon, Name,
  Nachrichtenzahl. Darstellungs-Metadaten wie `colorRole: "danger"`
  (Quarantäne) und `muted` (Spam) sind nicht Teil des `Folder`-API-Objekts
  (siehe `api-spec.yaml`) und liegen deshalb clientseitig in
  `src/folderMeta.ts`, 1:1 gespiegelt aus `design-tokens.json`
  `systemFolders.defaults`. Neue eigene Ordner lassen sich über ein
  Eingabefeld + Button am unteren Sidebar-Rand anlegen (`POST /folders`,
  Default-Icon `folder` aus `customFolder.defaultIcon`). Umbenennen per
  Stift-Icon (Inline-Edit) für alle Ordner außer Quarantäne/Spam
  (`renamable: false` im Contract — Server lehnt den Rename zusätzlich mit
  403 ab, falls die UI umgangen wird). Löschen per Papierkorb-Icon nur für
  eigene Ordner (System-Ordner haben keinen Löschen-Button; der Server
  lehnt `DELETE` auf System-Ordnern ebenfalls mit 403 ab). Theme-Switch
  (Hell/Dunkel/System) unverändert.
- **Mittlere Spalte:** Nachrichtenliste des aktiven Ordners. Nachrichten,
  die nicht `safe` klassifiziert sind, zeigen direkt in der Liste ein
  kompaktes Security-Badge.
- **Rechte Spalte:** Detailansicht der ausgewählten Nachricht mit großem
  Security-Badge, aufklappbaren Sicherheits-Details (SPF/DKIM/DMARC,
  Domain-Alter, Reputation, Homoglyph-Erkennung, Link-Mismatch,
  Dringlichkeits-Sprache, neue IBAN, Konfidenz — alle 11 Felder aus
  `SecurityResult`), Body-Text sowie Aktionen ("In Quarantäne
  verschieben", "Löschen" → `DELETE /messages/{id}` (soft delete, siehe
  Abschnitt "Papierkorb" unten), ein Dropdown "In Ordner verschieben…" (`POST
  /messages/{id}/move`, zeigt alle Ordner außer dem aktuellen), "Inhalt"
  (Label-Umbenennung 09.09., technisch weiterhin `MailSummary`.summaryText)
  → `MailSummary`, "Antwortentwurf erstellen" → `draftText`, editierbar mit
  echtem "Senden"-Button (siehe Abschnitt "Versand & Anhänge" unten)).
- **Quarantäne-Ansicht:** ist kein separater Screen, sondern der
  System-Ordner mit `systemKey: "quarantaene"` in derselben
  Liste/Detail-Struktur. Die Detailansicht macht dort über das
  Security-Badge + die Sicherheits-Details transparent, warum eine
  Nachricht dort liegt (z. B. SPF/DKIM/DMARC fail, Homoglyph-Domain, neue
  IBAN im Text).
- **Papierkorb (Nachtrag 08.09., WEB_INBOX.md "Fehlende Basis-Funktion
  entdeckt", Contract-Commit `156f0fd`):** 6. System-Ordner
  (`systemKey: "papierkorb"`, Icon `trash-2`, nicht umbenennbar/löschbar
  wie Quarantäne/Spam). "Löschen" in der Detailansicht ruft `DELETE
  /messages/{id}` auf (soft delete, verschiebt die Nachricht dorthin — kein
  neuer Mechanismus, serverseitig wie `move` mit fest verdrahtetem
  Ziel-Ordner). Liegt die angezeigte Nachricht bereits im Papierkorb, zeigt
  die Detailansicht stattdessen einen Hinweis-Banner und den Button
  "Endgültig löschen" (mit Bestätigungsdialog) → `DELETE
  /messages/{id}/permanent`, entfernt die Nachricht unwiderruflich aus dem
  Mock-Datensatz. Zurückholen aus dem Papierkorb funktioniert über das
  vorhandene Dropdown "In Ordner verschieben…". Anders als bei Quarantäne
  gibt es laut Contract keine automatische Frist/Retention-Tabelle für den
  Papierkorb — Nachrichten bleiben liegen, bis der User sie verschiebt oder
  endgültig löscht.

### Ordner (Contract-Update 08.09.)

- `Folder` ist jetzt ein Objekt (`{id, name, icon, isSystem, systemKey,
  sortOrder}`), keine feste String-Enum mehr. `Message.folderId` verweist
  per UUID auf einen `Folder` statt eines Enum-Werts.
- Mock-Daten: 7 System-Ordner (`is_system: true`, `system_key`:
  eingang/entwuerfe/gesendet/sonstiges/quarantaene/spam/papierkorb, siehe
  Ordner-Umbau unten) plus zwei Beispiel-Ordner "Familie" und "Rechnungen"
  (`is_system: false`, `system_key: null`) mit eigenen Beispiel-Nachrichten,
  um zu zeigen, dass eigene Ordner vollwertig funktionieren. Der
  Papierkorb-Ordner enthält zwei Beispielnachrichten, die bereits
  (soft-)gelöscht sind.
- **Design-Entscheidung (08.09., Track F, nicht im Contract vorgegeben):**
  was passiert mit Nachrichten in einem gelöschten Ordner? `api-spec.yaml`
  sagt dazu nichts. Der Mock-Server verschiebt sie beim `DELETE
  /folders/{id}` nach "Sonstiges" statt sie zu verlieren (analog zum
  Verhalten vieler Mail-Clients). Reines Mock-Verhalten — Track A muss für
  das echte Backend entscheiden, ob das so übernommen wird oder ob z. B.
  eine Bestätigung/Warnung nötig ist, wenn der Ordner nicht leer ist.

### Ordner-Umbau (10.09., WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
Ordner-Umbau-Eintrags")

Standard-Ordner-Liste geändert: `wichtig`/`rechnungen` entfallen als
System-Ordner (der User kann beides weiterhin als eigenen Ordner anlegen —
"Rechnungen" existiert deshalb in den Mock-Daten jetzt als normaler
benutzerdefinierter Ordner unter derselben `folderId` weiter, damit
bestehende Deep-Links/Tests nicht brechen). `eingang` ersetzt `wichtig` als
echte automatische Landezone (neue, normale Mail landet dort statt in
"Sonstiges"). `entwuerfe`/`gesendet` sind neu:

- **`entwuerfe`** zeigt `GET /drafts` (`src/components/DraftList.tsx`),
  NICHT `GET /messages` — Entwürfe sind eine eigene Ressource (siehe
  Abschnitt "Versand & Anhänge"). Bewusst nur Liste + Löschen, kein
  Bearbeiten: ein Entwurfs-Editor bräuchte einen eigenen Compose-Screen
  ("neue Mail verfassen"), der noch nicht Teil dieses Clients ist.
- **`gesendet`** zeigt normale `Message`-Objekte wie jeder andere Ordner —
  das Backend/der Mock-Server legt nach einem erfolgreichen
  `POST /messages/send` selbst eine lokale `messages`-Zeile dort an.
  App.tsx lädt diesen Ordner nach jedem erfolgreichen Versand gezielt neu
  (`onSent`-Callback von `MessageDetailPane`), sonst bliebe der
  Sidebar-Zähler bis zum nächsten vollständigen Neuladen auf 0 stehen —
  das war ein echter, im Browser gefundener und behobener Bug beim
  Implementieren dieses Schritts, kein rein theoretisches Risiko.
- Icons: `inbox` (eingang), `file-pencil` (entwürfe), `send` (gesendet) neu
  in `src/icons.tsx` ergänzt (fallen sonst auf `FolderIcon` zurück, siehe
  `FolderSidebar.tsx`).

## Versand & Anhänge (10.09., WEB_INBOX.md 09.09.)

- **`POST /messages/send`:** der Entwurfstext unter "Antwortentwurf
  erstellen" ist jetzt in einem echten `<textarea>` editierbar mit einem
  funktionierenden "Senden"-Button (`src/components/MessageDetailPane.tsx`).
  Bei `422` (serverseitiger Phishing-Block, gleiche Response-Form wie
  `/messages/draft/phishing-check`) zeigt die UI den `reason` direkt unter
  dem Entwurf; bei Erfolg eine Bestätigung ("Antwort an … wurde gesendet.")
  und die Entwurfskarte verschwindet. `api.ts` wirft dafür einen eigenen
  `ApiError` (mit `status`/`body`), damit die Komponente zwischen "blockiert"
  und "echter Fehler" unterscheiden kann — der generische `request()`-Helper
  wirft sonst nur einen undifferenzierten `Error`.
- **`POST /attachments`:** "Anhang hinzufügen" öffnet den nativen
  Datei-Picker (`<input type="file" multiple hidden>`), jede ausgewählte
  Datei wird sofort einzeln hochgeladen (parallele Requests, nicht
  nacheinander) und zeigt ihren Scan-Status live (Spinner-Text → "Geprüft"
  grün oder den jeweiligen Blockier-Grund rot, inkl. Entfernen-Button).
  "Senden" bleibt deaktiviert, solange irgendein Anhang noch hochlädt oder
  nicht `clean` ist (`hasBlockingAttachment` in `MessageDetailPane.tsx`).
  Der Mock-Server-Scan ist dieselbe einfache Dateiendungs-Heuristik wie im
  echten Backend (`attachmentScanMock.ts`), dupliziert statt geteilt
  (verschiedene Sprachen/Prozesse) — ein Dateiname mit "virus"/"malware"
  ist ein deterministischer Test-Trigger für `malicious`.
- **Grenze (bewusst, wie im echten Backend):** der Dateiinhalt wird nicht
  gespeichert, ein hochgeladener Anhang wird deshalb aktuell nicht
  tatsächlich in die "gesendete" Mail eingebettet — nur der Scan-Gate
  (blockiert ungeprüfte/gefährliche Anhänge beim Versand) ist fertig.
- **Entwürfe (`/drafts`):** siehe Abschnitt "Ordner-Umbau" oben — Liste +
  Löschen sind verdrahtet, ein Compose-Screen zum Anlegen/Bearbeiten von
  Entwürfen aus der UI heraus ist bewusst nicht Teil dieses Schritts
  (`api.createDraft`/`api.updateDraft` existieren bereits für einen
  künftigen Compose-Screen, werden aber aktuell von keiner Komponente
  aufgerufen).

## Antworten-Button bei Spam (10.09., WEB_INBOX.md 09.09. "KORREKTUR der
letzten Regel")

"Antwortentwurf erstellen" wird in `MessageDetailPane.tsx` ausgeblendet,
wenn die Nachricht sich **aktuell** im `spam`-Systemordner befindet
(`message.folderId === spamFolderId`, neue Prop von `App.tsx` durchgereicht)
— NICHT, wenn `classification === 'spam'` irgendwann mal galt. Verschiebt
der User eine fälschlich einsortierte Mail manuell raus (z. B. nach
"Eingang"), ist der Button sofort wieder da, ganz ohne neues Feld/neue
Sonderlogik — die Bedingung hängt am aktuellen Ordner, nicht am
eingefrorenen KI-Urteil. Gilt bewusst NICHT für Quarantäne (Phishing): dort
bleibt der Button sichtbar (mit Warnbanner wie bisher), weil der User eine
Phishing-Mail trotzdem sehen/melden können soll. Reine UI-Bedingung, kein
Backend-/Contract-Change nötig (`folderId` existierte bereits).

Verifiziert im Browser: Nachricht im Spam-Ordner → Button fehlt; per
"In Ordner verschieben…" nach "Eingang" verschoben → Button erscheint
sofort wieder, obwohl das (eingefrorene) `classification`-Badge weiterhin
"Spam" zeigt.

## Antworten ohne KI-Zwang (10.09., WEB_INBOX.md-Priorität "erst Funktion, dann Optik")

**Fund:** Das Compose-Feld ließ sich vorher gar nicht öffnen, ohne einen
KI-Entwurf abzurufen — `MessageDetailPane.tsx` band die Sichtbarkeit des
Antwortfelds direkt an `draft: string | null`, das ausschließlich nach
einem erfolgreichen `POST /messages/{id}/reply-draft` gesetzt wurde. Der
einzige Button hieß "Antwortentwurf erstellen" und löste diesen KI-Aufruf
sofort aus — eine normale, selbst getippte Antwort ohne KI war UI-seitig
nicht möglich, obwohl das Backend das nie verlangt hat.

**Fix:** `draft` ersetzt durch zwei getrennte States: `replyOpen: boolean`
(steuert allein, ob das Compose-Feld sichtbar ist) und `body: string` (von
Anfang an `""`, sofort editierbar, `autoFocus`). Der Button heißt jetzt
"Antworten" und setzt nur noch `replyOpen = true` — kein Netzwerk-Call.
Innerhalb des offenen Felds gibt es jetzt zwei zusätzliche Buttons:
"KI-Entwurf vorschlagen" (optional, ruft `api.createReplyDraft()` auf und
füllt `body`; fragt per `window.confirm` erst nach, wenn bereits eigener
Text im Feld steht, damit ein versehentlicher Klick nichts stillschweigend
verwirft) und "Verwerfen" (schließt das Feld wieder, `replyOpen = false`,
`body = ""` — vorher gab es keinen Weg zurück, sobald ein Entwurf geladen
war, außer Senden). Gleiche Sichtbarkeitsregel wie vorher unverändert
übernommen (kein "Antworten"-Button im `spam`-Ordner, siehe Abschnitt
oben).

Verifiziert per Browser-Automation gegen den Mock-Server: "Antworten"
öffnet das Feld sofort leer und fokussiert, "Senden" bleibt bis zur ersten
Eingabe deaktiviert, "Verwerfen" schließt das Feld wieder, "KI-Entwurf
vorschlagen" füllt es mit einem KI-Text (Mock-Server liefert einen
Platzhaltertext).

## Onboarding, Sicherheits-Badges, App-Sperre (WEB_INBOX.md 19.09., "PRIORITAET - naechster Schritt")

Drei UI-Nachträge zu bereits fertigem Backend/Contract:

1. **Onboarding-Provider-Auswahl** (`OnboardingScreen.tsx`, ersetzt das
   bisherige `LoginScreen.tsx`, das nur Gmail kannte): Karten-Grid aus
   `GET /mail-providers` (`contracts/mail-providers.json`, EINE Quelle statt
   Presets pro Plattform hart zu codieren — Track C/iOS folgt demselben
   Contract). Gmail (`authType=oauth`, nicht `comingSoon`) ist ein echter
   `<a href>`-Redirect zu `GET /auth/google/start` (kein `fetch`, siehe
   vorheriger LoginScreen-Kommentar); Outlook/Yahoo sind `comingSoon` und
   nicht klickbar; iCloud/GMX/web.de/generisches IMAP öffnen ein
   IMAP-Formular, vorbefüllt aus dem Provider-Preset (Host/Port/TLS), mit
   App-Passwort-Hinweis + Link (`appPasswordHelpUrl`), falls
   `requiresAppPassword=true`. Submit ruft `POST /accounts`
   (`provider=imap`) — das echte Backend verifiziert die Zugangsdaten per
   echtem IMAP-Login (`422` bei Fehlschlag), der Mock-Server (siehe unten)
   nimmt jede Eingabe unverändert an.
2. **Sicherheits-Badges** (`SecurityBadge.tsx`: neue `SecuritySignalBadges`-
   Komponente + drei neue Zeilen in `SecurityDetails`): zeigt
   `displayNameSpoofingDetected`/`replyToMismatchDetected`/
   `ibanChangedInThread` (aus `SecurityResult`, seit den Sicherheits-
   Ergänzungen vom 15.09. im Contract/Backend vorhanden, im Web-Client
   bisher nur nicht gespiegelt) sowie `isNewSender` (Feld auf
   `MessageDetail`, kombiniert mit `GET /trusted-senders` — Badge nur bei
   `isNewSender=true` UND Absender nicht auf der Whitelist, exakt wie in
   `api-spec.yaml` beschrieben). Nutzt durchgehend die bestehende
   `tone-{success|warning|danger}`-Konvention (`SecurityBadge.css`), keine
   neue visuelle Sprache. Nur in der Detailansicht (Header-Zeile) gezeigt,
   nicht in `MessageList`-Zeilen — die dort verwendete `Message`-Summary
   (`GET /messages`) enthält diese Felder nicht, nur `MessageDetail`
   (`GET /messages/{id}`); alle Zeilen zusätzlich pro Nachricht laden wäre
   ein eigener Contract-/Performance-Schritt, nicht Teil dieses Auftrags.
3. **Web-Äquivalent zur iOS-App-Sperre** (`useAppLock.ts` + `AppLockGate.tsx`,
   Toggle in `FolderSidebar.tsx`): geprüft und UMGESETZT, kein reiner
   Dokumentations-Verzicht wie bei anderen "prüfen ob sinnvoll"-Aufträgen.
   Nutzt die WebAuthn-Plattform-Authenticator-API (Touch ID/Windows
   Hello/Android-Biometrie) rein lokal — kein Server-Roundtrip, kein neues
   Backend-Konzept, direkt analog zu iOS' `LocalAuthentication`
   (`ios/DriftmailApp/Security/BiometricLock.swift`). Sperrt nach 5 Minuten
   Inaktivität oder wenn der Tab länger als 15 Sekunden im Hintergrund war
   (Annäherung an iOS' "sperrt bei JEDEM Verlassen von `.active`" — im
   Browser wäre das bei normalem Tab-Wechsel störend gewesen). **Wichtige,
   bewusst dokumentierte Grenze** (ausführlich im Kopfkommentar von
   `useAppLock.ts`): anders als bei iOS (Keychain/Secure Enclave) kann diese
   Geste den Session-Token in `localStorage` nicht kryptografisch schützen
   (siehe `api.ts`-Kommentar zu `TOKEN_STORAGE_KEY`) — es ist eine
   Blickschutz-/Shoulder-Surfing-Maßnahme, keine echte Zugriffskontrolle.
   Deshalb: (a) der Schalter erscheint nur, wenn der Browser überhaupt einen
   Plattform-Authenticator hat (`isUserVerifyingPlatformAuthenticatorAvailable()`),
   sonst kein totes UI; (b) der Sperrbildschirm hat einen "Stattdessen
   abmelden"-Fallback, damit ein Sensor-/Browser-Problem den User nicht
   dauerhaft aussperrt. Verifiziert per Browser-Automation gegen den
   Mock-Server: Provider-Grid, IMAP-Formular inkl. Preset-Vorbefüllung, alle
   vier neuen Badges (Header + Detail-Zeilen) an den passenden
   Demo-Nachrichten, App-Sperre-Toggle inkl. sauber abgefangenem
   Fehlerpfad (kein echter Plattform-Authenticator in der Testumgebung
   verfügbar — der Erfolgspfad ist Standard-WebAuthn-API, auf echter
   Hardware (Touch ID o.ä.) nicht separat verifizierbar in dieser Umgebung).

Mock-Server-Ergänzungen (`mock-server/server.mjs`/`data.mjs`): `GET
/mail-providers` liefert `contracts/mail-providers.json` unverändert aus
(gleiches Muster wie `backend/src/routes/mailProviders.ts`); `GET/POST/DELETE
/trusted-senders` sind ein einfacher In-Memory-Array (kein Whitelist-
Matching-Logik nötig, das übernimmt die echte Backend-Klassifikation); die
Phishing-Demo-Mail hat jetzt `displayNameSpoofingDetected`/
`replyToMismatchDetected`/`ibanChangedInThread=true`, eine Eingang-Mail
(Notariat Weber) hat `isNewSender=true`, damit die neuen Badges in der
Mock-UI überhaupt sichtbar sind.

## Jetzt aktualisieren (WEB_INBOX.md 21.09., "SEHR WICHTIGE LUECKE - HOECHSTE PRIORITAET")

Kleiner Rund-Button (Refresh-Icon) neben der Konto-E-Mail-Adresse in der
Sidebar, ruft `POST /accounts/{accountId}/sync` auf (löst sofort einen
Mail-Abruf aus, statt auf das automatische Backend-Intervall zu warten)
und lädt danach alle Ordner neu. Kein eigenes Client-seitiges Polling für
`GET /messages` -- das automatische Nachziehen neuer Mail läuft
serverseitig (siehe `backend/README.md` "Automatischer + manueller
Mail-Abruf"), dieser Button ist nur der explizite "jetzt sofort"-Weg. Per
`curl`/Netzwerk-Log gegen den Mock-Server verifiziert (200 OK).

## Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2, "getrennte Ansichten pro Konto")

`App.tsx`: `account: MailAccount | null` → `accounts: MailAccount[]` +
`activeAccountId`. Sidebar zeigt bei genau einem Konto weiterhin nur die
E-Mail-Adresse, ab zwei Konten einen `<select>`-Umschalter (kein
aufwendigeres Dropdown-Design -- native Selects sind barrierefrei und
brauchen keine eigene Fokus-/Tastatur-Logik). Beim Kontowechsel werden
Ordner/Nachrichten/Entwürfe/Auswahl komplett neu geladen (`activeAccountId`
in den Effekt-Dependencies) -- alte Ordner-IDs gehören zum vorherigen
Konto und wären für das neue irreführend.

"Konto hinzufügen" (`+`-Button neben dem Sync-Button) öffnet denselben
`OnboardingScreen` als Overlay über der bereits eingeloggten App (neuer
`mode="addAccount"`-Prop), nicht als Vollbild-Gate wie beim Erst-Login --
`api.ts` hängt den bereits gespeicherten Token automatisch an jeden
Request, das Backend erkennt daran "weiteres Konto zu bestehendem Login"
(siehe `backend/README.md`). Gmail ist im `addAccount`-Modus bewusst
deaktiviert (eigene Erklärung statt eines kaputten Flows) -- der echte
OAuth-Redirect kann den bestehenden Login-Zustand nicht durchreichen,
siehe SYNC.md "Offene Frage" an Track A.

`GET /folders`/`POST /folders` nehmen jetzt ein optionales `accountId`.

**Mock-Server-Grenze, bewusst nicht behoben:** `mock-server/data.mjs`
bildet nur EIN Konto ab (`accounts[0]`), `POST /accounts` gibt dieses immer
zurück statt ein zweites anzulegen -- der komplette "Konto hinzufügen"-
Flow läuft fehlerfrei durch (per Browser-Test verifiziert, keine Konsolen-
Fehler), zeigt aber am Ende weiterhin nur ein Konto, weil der Mock keine
echte Mehrfach-Konten-Datenstruktur hat. Für eine echte Verifikation des
Kontowechsels selbst: gegen `backend/` testen (dort per Smoketest
abgedeckt, siehe `backend/README.md`), nicht gegen den Mock. Ein
vollständiger Mock-Umbau (mehrere Konten, pro Konto eigene Ordner/
Nachrichten) wäre ein eigener, größerer Schritt gewesen -- die
UI-Logik selbst hängt nicht am Mock, deshalb hier bewusst nicht
mitgemacht.

## Compose-Screen (neue Mail, Antworten, Weiterleiten, Suche) — [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "BUG - Massimo beim echten Live-Test entdeckt" +
"ERGAENZUNG" + "DREI WEITERE GRUNDFUNKTIONEN")

**Ein gemeinsamer Dialog statt drei getrennter UIs:** `ComposeModal.tsx`
deckt alle drei Fälle ab (`mode: "new" | "reply" | "forward"`), weil
To/CC/BCC/Betreff/Body in allen drei Fällen dieselben Felder sind, nur die
Vorbefüllung unterscheidet sich. Ersetzt das bisherige inline in
`MessageDetailPane.tsx` eingebettete Antwort-Compose-Feld (das hatte kein
eigenes To-Feld -- Empfänger war hart auf `message.fromAddress` verdrahtet
und damit für Weiterleiten ungeeignet, und kein CC/BCC).

- **Neue Mail:** "Neue Nachricht"-Button in `FolderSidebar.tsx` (oben,
  direkt unter dem Logo -- behebt den von Massimo gefundenen fehlenden
  Compose-Button). Sender-Auswahl (`<select>`) nur sichtbar bei mehr als
  einem verbundenen Konto (WEB_INBOX.md 21.09. "ERGAENZUNG"), bei genau
  einem Konto automatisch dessen `accountId`.
- **Antworten:** wie bisher über den "Antworten"-Button in
  `MessageDetailPane.tsx`, öffnet jetzt aber den ComposeModal statt des
  inline-Felds -- To vorbefüllt mit der Absenderadresse, Betreff mit
  `Re: `-Präfix (idempotent, kein doppeltes Präfix bei erneutem Antworten
  auf eine bereits "Re:"-Mail), Body leer (weiterhin "Antworten ohne
  KI-Zwang" -- der KI-Entwurf-Button bleibt ein optionaler Zusatz
  innerhalb des Dialogs, nur im `reply`-Modus sichtbar, kein Pendant für
  neue Mail/Weiterleiten).
- **Weiterleiten** (neuer Button daneben, WEB_INBOX.md 21.09. "DREI
  WEITERE GRUNDFUNKTIONEN" Punkt 1): Betreff mit `Fwd: `-Präfix (gleiche
  Idempotenz-Logik), Body vorbefüllt mit einer zitierten Kopie der
  Ursprungsnachricht (Trennzeile + Von/Datum/Betreff + Originaltext), To
  leer (User trägt den neuen Empfänger ein). **Grenze, bewusst so
  belassen:** kein `forwardOf`-Bezug im Contract (der ursprünglich in
  WEB_INBOX.md vorgeschlagene Endpunkt-Umbau war nicht nötig) -- eine
  Weiterleitung ist technisch eine ganz normale neue Mail über
  `POST /messages/send` mit vorbefülltem Text, kein serverseitiger
  Sonderfall. Ebenfalls bewusst nicht automatisch mitgenommen: Original-
  Anhänge (WEB_INBOX.md nannte das explizit "optional") -- der User kann
  aber über denselben "Anhang hinzufügen"-Weg wie bei jeder anderen Mail
  neue Anhänge auswählen.
- **CC/BCC** (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN" Punkt 3):
  hinter einem "CC/BCC hinzufügen"-Link eingeklappt (Superhuman-Prinzip
  "nur zeigen, was gebraucht wird" -- die meisten Mails haben weder CC
  noch BCC), Klick zeigt beide Felder dauerhaft für den Rest des Dialogs.
  Komma-/Semikolon-getrennte Adresslisten wie beim bestehenden To-Feld.
  `api.sendMessage()` reicht `bcc` jetzt zusätzlich zu `cc` durch (Backend
  seit Commit `9c3a3ec`, siehe `backend/README.md` "Nachtrag: CC/BCC").

`onSent` (App.tsx `handleSent`) läuft unverändert nach jedem erfolgreichen
Versand -- lädt den "gesendet"-Ordner neu, egal ob aus "neu"/"antworten"/
"weiterleiten" gesendet wurde.

**Mock-Server:** `POST /messages/send` nahm `bcc` bereits stillschweigend
entgegen (JSON-Zusatzfelder werden ignoriert, kein Codeänderung nötig) --
für Konsistenz trotzdem ein erklärender Kommentar ergänzt.

### Suche (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN" Punkt 2)

Neues Suchfeld über der Nachrichtenliste (`message-column-header`),
kontoweit (nicht auf den gerade aktiven Ordner beschränkt -- beim Suchen
weiß man oft nicht mehr, in welchem Ordner eine Mail liegt). Ersetzt bei
nicht-leerem Suchbegriff die normale Ordner-/Entwürfe-Ansicht durch die
Ergebnisliste (`api.listMessages({ accountId, q })`, 250ms entprellt).
Klick auf ein Ergebnis öffnet die Detailansicht wie gewohnt.
`api.listMessages()` nimmt jetzt ein Options-Objekt
(`{ folderId?, accountId?, q? }`) statt eines einzelnen `folderId`-Strings.

`mock-server/server.mjs` `GET /messages` implementiert `q` mit derselben
Substring-Semantik wie das echte Backend (`.includes()` über subject/
fromAddress/fromDisplayName/bodyText), damit die Suche auch ohne den
echten Backend-Server lokal testbar ist. `accountId` wird im Mock-Server
nicht ausgewertet (er kennt ohnehin nur ein einziges Konto, siehe
"Mehrfach-Konten" oben).

**Tests:** `tsc -b` + `vite build` + `oxlint` grün (keine neuen Warnungen
gegenüber dem Bestand). Kompletter Flow per Browser-Automation gegen den
Mock-Server durchgeklickt: neue Mail mit CC+BCC gesendet (landet im
"gesendet"-Ordner), Suche nach dem Betreff dieser Mail findet sie
kontoweit, Weiterleiten dieser gefundenen Mail zeigt den korrekt
vorausgefüllten "Fwd:"-Betreff + zitierten Text, Antworten auf eine echte
Eingangs-Mail inkl. KI-Entwurf-Button funktioniert und sendet erfolgreich
(Gesendet-Zähler erhöht sich entsprechend).

## KI-Anbindung (BYOK) + On-Device-KI-Versuch — [2026-09-21] Nachtrag
(TERMINAL_INBOX.md 21.09. "KORREKTUR", ersetzt WEB_INBOX.md 21.09. "ECHTE
KI-ANBINDUNG" Commit c3ec563 vollständig -- Backend-Gegenstück in
`backend/README.md` Abschnitt "KI-Anbindung (BYOK)", dort auch die volle
Begründung der Architekturentscheidung, hier nur die Web-spezifischen
Details.)

**Kein driftmail-finanzierter Cloud-Key.** Geräte-eigene KI ist die primäre
Quelle, Cloud-KI läuft nur mit einem vom User selbst hinterlegten eigenen
API-Key ("BYOK"), auf dessen eigene Kosten, nur mit explizitem Consent.

### On-Device-Versuch (`src/onDeviceAi.ts`)

Vor jedem Aufruf von `GET /messages/{id}/summary` bzw.
`POST /messages/{id}/reply-draft` versucht der Client zuerst Chromes
"Prompt API" (globales `LanguageModel`), feature-detected -- kein Fehler in
Browsern ohne diese API.

**Real verifiziert in dieser Umgebung** (Chrome 153, per Browser-Tool):
`typeof LanguageModel === "function"` ist wahr, `LanguageModel.
availability()` liefert real `"downloadable"` (Modell hier nicht
vorinstalliert). Chrome bietet daneben auch eine dedizierte
`Summarizer`-API (ebenfalls vorhanden) -- bewusst nicht genutzt, ihr Output
ist eine feste Zusammenfassungsform ohne die hier gebrauchten strukturierten
Felder (`actionRequired`/`actionDescription`/`deadline`).

**Bewusste Entscheidung gegen einen automatischen Download:** `.create()`
wird nur versucht, wenn `availability()` bereits `"available"` liefert
(Modell schon vorhanden). Ein stiller Mehrere-GB-Download beim ersten Klick
auf "Inhalt"/"KI-Entwurf vorschlagen" wäre schlechtes Verhalten für eine
Aktion, die als schnell/lokal erwartet wird. Der Code aktiviert sich
automatisch, sobald ein Nutzer-Browser das Modell bereits geladen hat, ohne
dass driftmail selbst einen Download anstößt -- **in dieser Umgebung war
das Modell nicht geladen, ein tatsächlicher erfolgreicher On-Device-Aufruf
konnte deshalb nicht verifiziert werden** (nur der Feature-Detection- und
Fallback-Pfad, siehe Tests unten). Massimo hat das explizit als
akzeptabel benannt ("falls das zu aufwendig/neu ist ... ist ein
dokumentierter Verzicht darauf in Ordnung").

Bei Nichtverfügbarkeit/Fehlschlag: sauberer Fallback auf den bisherigen
Backend-Aufruf, `source: "on_device"` wird nur gesetzt, wenn der Versuch
tatsächlich erfolgreich lief.

### Drei Quellen, ehrlich unterschieden

`AiSource` (`src/types.ts`) hat jetzt drei statt zwei Werte -- `heuristic`
ist neu (kein KI-Modell, kein externer Anbieter, vorher fälschlich immer
als `cloud_fallback` gelabelt). `MessageDetailPane.tsx`s Zusammenfassungs-
Label und `ComposeModal.tsx`s KI-Entwurf-Quellenhinweis zeigen jetzt alle
drei Werte (On-Device / Cloud (eigener Zugang) / Regelbasiert).

### KI-Einstellungen (`src/components/AiSettingsModal.tsx`)

Neuer Dialog, erreichbar über einen "KI-Einstellungen"-Link unten in der
`FolderSidebar.tsx` (neben App-Sperre). An/Aus-Schalter (`mode`),
Anbieter-Auswahl (**bewusst nur `anthropic`/`openai`** -- nur diese beiden
sind serverseitig wirklich angebunden, `google`/`other` würden nur zu
einem 400 beim Speichern führen, siehe backend/README.md), Passwort-Feld
für den API-Key (wird nie zurückgegeben/angezeigt), Consent-Checkbox.
"Speichern" bleibt deaktiviert, solange Cloud-KI aktiviert, aber kein
Consent gesetzt ist -- verhindert den unklaren Zwischenzustand "BYOK an,
aber kein Consent". Neue `api.ts`-Methoden `getAiSettings()`/
`setAiSettings()` gegen `GET`/`PUT /ai-settings`.

**Echter Fund beim Testen:** `PUT /ai-settings` schlug im Browser mit
"Speichern fehlgeschlagen" fehl, obwohl derselbe Request per `curl` sauber
durchging -- der Mock-Server-CORS-`Access-Control-Allow-Methods`-Header
enthielt kein `PUT` (nur `GET,POST,PATCH,DELETE,OPTIONS`), der Browser
verwarf die Antwort nach dem Preflight. Im Mock-Server behoben (gleiche
Fehlerklasse wie der frühere Authorization-Header-Fund dort). **Das ECHTE
Backend (`backend/src/middleware/cors.ts`) hat dieselbe Lücke** -- dort
bewusst NICHT angefasst (Web-Track-Scope dieses Schritts) -- `PUT` muss
dort noch zu `Access-Control-Allow-Methods` ergänzt werden, sonst schlägt
`PUT /ai-settings` aus einem echten Browser heraus gegen das echte Backend
fehl, obwohl es laut `curl`/Smoketest funktioniert. Bitte bei Gelegenheit
nachziehen (ein Wort in einer bestehenden Zeile).

**Tests:** `tsc -b`/`vite build`/`oxlint` grün (keine neuen Warnungen
gegenüber dem Bestand). Kompletter Flow per Browser-Automation gegen den
erweiterten Mock-Server verifiziert: KI-Einstellungen öffnen, Cloud-KI
aktivieren, Anbieter wählen, Key eingeben (maskiert), Consent setzen,
speichern (inkl. des oben beschriebenen CORS-Fixes), Reload + erneutes
Öffnen bestätigt Persistenz (Key-Feld zeigt "Bereits hinterlegt" statt
leer), Ausschalten setzt serverseitig nachweislich alles zurück (per
`curl` gegen den Mock-Server verifiziert). "Inhalt" auf einer echten
Nachricht zeigt danach korrekt "Zusammenfassung (Regelbasiert)" -- der
On-Device-Versuch lief durch (kein Fehler in der Konsole), fiel mangels
geladenem Modell sauber auf den Backend-Weg zurück.

## Kleine Ergänzungen — [2026-09-21] Nachtrag

- **Label-Umbenennung** (WEB_INBOX.md 21.09. "KLEINE LABEL-AENDERUNG"): der
  Button "Inhalt" (KI-Zusammenfassung) heißt jetzt "Check Mail" --
  ausdrücklich von Massimo so entschieden, Alternative "Zusammenfassung"
  bewusst abgelehnt. Reine Text-Änderung, `summaryText` intern unverändert.
- **"Absender vertrauen" direkt am Badge** (WEB_INBOX.md 21.09. "KLEINE
  VERKNUEPFUNG"): `SecuritySignalBadges` bekommt einen optionalen
  `onTrustSender`-Callback -- nur beim "Neuer Absender"-Badge in der
  Detailansicht sichtbar (nicht in `compact`-Listenzeilen, dort ist kein
  Platz für eine Aktion), ruft `POST /trusted-senders` auf. `App.tsx`
  aktualisiert `trustedSenderAddresses` optimistisch, damit das Badge sofort
  für ALLE Nachrichten dieses Absenders verschwindet, nicht nur die gerade
  geöffnete. `api.ts` bekam dafür `addTrustedSender()` -- `POST
  /trusted-senders` existierte im Contract bereits seit dem
  Whitelist-Auftrag (15.09.), wurde aber nie von Web aufgerufen.

## Einstellungsbereich — [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "NEUER AUFTRAG - Einstellungsbereich + Info-Seite",
Punkt 1 -- Punkt 2, die öffentliche Info-Seite auf driftware.online, läuft
laut Massimo bereits über eine andere Claude-Session, hier bewusst nicht
angefasst)

**Neuer `SettingsModal.tsx`**, geöffnet über ein Zahnrad-Icon
("Einstellungen") unten in `FolderSidebar.tsx` -- bündelt, was bisher über
die Sidebar verstreut war (App-Sperre-Toggle, KI-Einstellungen-Link),
PLUS neu:

- **Konten:** Liste der verbundenen Konten + "Konto hinzufügen" (nutzt den
  bereits bestehenden Onboarding-Overlay-Flow aus `App.tsx`, kein zweiter
  Flow) + pro Konto ein "Entfernen"-Button (`DELETE /accounts/{id}`, neue
  `api.ts`-Methode `deleteAccount()`). Der Button ist clientseitig
  deaktiviert, solange nur ein Konto existiert (die 400-Antwort des
  Backends dafür wird also nie im Normalfall provoziert, nur als
  Doppel-Absicherung im Catch-Block behandelt).
- **Ansicht:** die 5 Akzentfarben-Swatches aus `contracts/design-tokens.json`
  `color.accentThemes` (neue lokale Kopie in `web/src/accentThemes.ts`,
  gleiches Nicht-Build-Time-Import-Prinzip wie `tokens.css`). Auswahl setzt
  `--color-accent` sofort inline auf `<html>` (optimistisches Update, siehe
  `applyAccentTheme()`) UND speichert über `PUT /settings`
  (`api.ts` `updateSettings()`), nach Login einmalig via `GET /settings`
  geladen und angewendet. **Bewusste Grenze bei "Ocean-Verlauf":**
  `--color-accent` selbst bekommt nur die erste Gradient-Farbe (ein echter
  CSS-Gradient-String würde bei mehreren bestehenden Verwendungen wie
  `color-mix(..., var(--color-accent), ...)` für Hover-Zustände oder
  Textfarben schlicht verworfen/ungültig) -- der echte Gradient ist nur in
  der Swatch-Vorschau selbst sichtbar, eine echte Gradient-Anwendung im UI
  wäre ein eigener, größerer Schritt.
- **Sicherheit:** App-Sperre-Toggle und KI-Einstellungen-Link sind
  hierher umgezogen (nicht dupliziert), PLUS eine neue, bewusst nicht-
  technische Text-Übersicht der aktiven Sicherheits-Features -- **ehrlich
  formuliert:** der Malware-Scan wird explizit als "in Vorbereitung"
  gekennzeichnet, weil er das tatsächlich noch ist (weiterhin nur
  `backend/src/lookups/attachmentScanMock.ts`, kein echter ClamAV-Scan).
- **Anleitung:** ein Link "Installationsanleitung" -- zeigt aktuell nur
  auf `https://driftware.online` als Platzhalter, bis die andere
  Claude-Session die eigentliche Info-Seite mit einer konkreten
  Unterseiten-Route fertig hat (Code-Kommentar an der Stelle verweist
  darauf, für eine spätere Verschärfung).

**Echter Fund beim Testen:** `AiSettingsModal` und `SettingsModal` sind
beide `.compose-overlay`-Overlays mit demselben `z-index`. Ursprünglich
war geplant, KI-Einstellungen einfach zusätzlich zu Settings zu öffnen
("stapeln") -- das rendert aber lautlos falsch: der später im DOM
gemountete `SettingsModal` verdeckt `AiSettingsModal` komplett, kein
Fehler, einfach nichts sichtbar. Behoben, indem `SettingsModal` sich
schließt, bevor KI-Einstellungen öffnet (gleiches Prinzip wie beim
bereits bestehenden "Konto hinzufügen"-Übergang). Nur durch echtes Klicken
im Browser gefunden, nicht durch `tsc`/`vite build` -- Erinnerung, warum
dieses Projekt "gebaut" nie mit "getestet" gleichsetzt.

**Mock-Server:** `GET`/`PUT /settings` und `DELETE /accounts/:id` ergänzt
(gleiches Validierungsverhalten wie das echte Backend). **Bewusste
Mock-Grenze, nicht neu:** `data.mjs` bildet weiterhin nur EIN Konto ab
(bereits als bekannte Grenze in der "Mehrfach-Konten"-Sektion oben
dokumentiert) -- ein zweites Konto lässt sich über den Mock-Server nicht
wirklich verbinden, der "letztes Konto kann nicht entfernt
werden"-400-Pfad UND die clientseitige Disabled-Logik dafür sind aber
echt verifiziert.

**Tests:** `tsc -b`/`vite build`/`oxlint` grün (keine neuen Warnungen).
Kompletter Flow per Browser-Automation gegen den Mock-Server
durchgeklickt: Settings öffnen, Akzentfarbe wechseln (sichtbare Live-
Umfärbung per Vorher/Nachher-Screenshot bestätigt, u.a. "Neue
Nachricht"-Button + aktive Ordnerzeile), Reload bestätigt Persistenz
(erneuter `GET /settings`-Aufruf beim Login), App-Sperre-Toggle von der
neuen Stelle aus ausgelöst (bekannte WebAuthn-Grenze in dieser Umgebung,
keine echte Plattform-Authenticator-Hardware verfügbar -- vorbestehende
Einschränkung, keine Regression), KI-Einstellungen von der neuen Stelle
aus geöffnet (nach dem oben beschriebenen Fix korrekt sichtbar),
"Entfernen" bei genau einem Konto nachweislich wirkungslos (deaktiviert),
"Konto hinzufügen" schließt Settings korrekt und öffnet den bestehenden
Onboarding-Overlay, "Abbrechen" dort kehrt sauber zurück ohne dass
Settings sich unerwartet wieder öffnet. Konsole ohne Fehler.

## [2026-09-21] Nachtrag: Fünf Komfort-Features
(WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES", Web-UI zu den vier
Punkten mit UI-Anteil, aufbauend auf der Backend-Grundlage aus
`backend/README.md` "Fuenf Komfort-Features (Backend-Grundlage)". Punkt 3
("Anhänge automatisch nach Öffnen scannen") und Punkt 5 brauchten laut
Backend-README keine Web-Änderung.)

**Punkt 1 -- Unbekannte Absender streng behandeln:** neuer Toggle
"Unbekannte Absender streng behandeln" im "Sicherheit"-Abschnitt von
`SettingsModal.tsx`, wie die anderen Settings-Felder optimistisch über
`PUT /settings` gespeichert (mit Rollback bei Fehler, gleiches Muster wie
der App-Sperre-Toggle). Ist der Toggle an UND eine Nachricht kommt von
einem neuen, nicht vertrauten Absender, bekommt der Nachrichten-Header in
`MessageDetailPane.tsx` zusätzlich zum bestehenden dezenten "Neuer
Absender"-Badge einen warnfarbenen Rahmen/Hintergrund
(`.detail-header-unknown-sender`, `--color-warning`-basiert) -- das
bestehende Badge bleibt unverändert, es kommt nur eine stärkere
Umrandung hinzu. **Bewusste Grenze:** `MessageList.tsx`-Zeilen nutzen den
schlankeren `Message`-Typ (kein `isNewSender`-Feld, das existiert nur auf
`MessageDetail`) -- die verstärkte Darstellung ist deshalb nur in der
Detailansicht möglich, nicht schon in der Ordner-Listenzeile. Das wäre
eine Erweiterung des `Message`-Contracts und damit außerhalb dieses
Web-only-Auftrags.

**Punkt 2 -- Kontakt-Autovervollständigung:** neue `api.listContacts()`
(`GET /contacts`) plus natives HTML `<datalist id="known-contacts">` in
`ComposeModal.tsx`, per `list="known-contacts"` an die An-/CC-/BCC-Felder
gehängt -- bewusst kein eigenes JS-Dropdown, der Browser übernimmt
Filterung/Rendering der Vorschläge selbst.

**Punkt 4 -- Threaded Ansicht (gruppierte Liste):** `MessageList.tsx`
gruppiert Nachrichten jetzt clientseitig über `inReplyToMessageId`-Ketten
-- aber **nur innerhalb der aktuell geladenen Liste** (ein Ordner lädt
weiterhin nur seine eigenen Nachrichten auf einen Schlag, siehe
"Annahmen/offene Punkte" oben; ein Elternteil in einem anderen Ordner
wird nicht aufgelöst). Pro Gruppe ist nur die neueste Nachricht als
sichtbare Zeile zu sehen, mit einem "+N ältere"/"Ältere
ausblenden"-Klapp-Link darunter; Gruppen mit genau einer Nachricht sehen
optisch unverändert aus (kein Klapp-Link, keine Regression gegenüber
vorher).

**Punkt-3-Nachtrag (Entwurf-Autosave):** kein eigener Backend-Punkt aus
der Fünf-Komfort-Liste, aber Teil desselben WEB_INBOX.md-Eintrags --
`ComposeModal.tsx` speichert jetzt automatisch, 3 Sekunden nach der
letzten Eingabe (feste, nicht konfigurierbare Debounce-Zeit, bewusst kurz
gewählt für schnelles Feedback ohne bei jedem Tastendruck zu speichern),
nur bei "Neue Nachricht"/"Weiterleiten" (nicht bei "Antworten") und nur,
wenn wirklich Inhalt (Empfänger, Betreff oder Text) vorhanden ist. Erster
Speicherversuch ruft `api.createDraft(...)`, jeder weitere
`api.updateDraft(id, ...)` mit derselben Draft-Id (in einem `useRef`
gehalten, nicht `useState` -- der Wert muss im debounced Effekt lesbar
UND schreibbar sein, ohne den Effekt selbst erneut auszulösen; eine
echte `react-hooks(exhaustive-deps)`-Warnung von `oxlint` hat auf dieses
Muster hingewiesen). Die entstandene Draft-Id wird beim Senden als
`draftId` an `api.sendMessage(...)` durchgereicht, sodass das Backend den
Entwurf beim erfolgreichen Versand selbst löscht. Schließt/verwirft der
Nutzer den Compose-Screen stattdessen, bleibt der zuletzt gespeicherte
Entwurf unangetastet stehen (kein Lösch-Aufruf beim Schließen). Ein
kleiner Status-Hinweis ("Entwurf gespeichert") erscheint neben dem
bestehenden KI-Quelle-Hinweis in der Aktionsleiste.

**Echter Fund im Mock-Server:** `PUT /settings` in
`mock-server/server.mjs` hat `userSettings` bisher komplett ersetzt statt
zu mergen -- ein Update mit nur `strictUnknownSenders` im Body hätte
`accentTheme` stillschweigend auf den Default zurückgesetzt. Behoben,
Felder werden jetzt einzeln gemergt (gleiches Prinzip wie bei den
bestehenden Settings-Feldern).

**Mock-Server:** `userSettings` um `strictUnknownSenders` (Default
`true`) ergänzt; neuer `GET /contacts`-Handler (dedupliziert/sortiert aus
den vorhandenen Nachrichtenabsendern); `data.mjs` bekommt eine zweite
Notariat-Weber-Nachricht mit `inReplyToMessageId` auf die bestehende, um
eine echte, testbare Zwei-Nachrichten-Kette im "Eingang"-Ordner zu haben.

**Tests:** `tsc -b`/`vite build`/`oxlint` grün (keine neuen Warnungen
über die bestehende Baseline hinaus). Per Browser-Automation gegen den
Mock-Server durchgeklickt: Toggle "Unbekannte Absender streng behandeln"
an/aus bestätigt sichtbaren Unterschied am Nachrichten-Header der
Notariat-Weber-Testnachricht (Badge bleibt in beiden Zuständen, Rahmen/
Hintergrund nur bei "an"); Eintippen von "notar" im An-Feld bestätigt
über die `<datalist>`-Optionen im DOM (18 Einträge aus `GET /contacts`),
dass `notar.weber@notariat-weber.de` korrekt vorgeschlagen wird; Tippen
von Empfänger/Betreff/Text im Compose-Screen, 3 Sekunden warten,
bestätigt sowohl den "Entwurf gespeichert"-Hinweis als auch direkt per
`GET /drafts` gegen den Mock-Server, dass der Entwurf mit den korrekten
Feldern serverseitig existiert; "Eingang" zeigt die Notariat-Weber-Kette
korrekt als eine Zeile + "+1 ältere", Aufklappen zeigt die ältere
Nachricht als Unterzeile, beide Zeilen öffnen die richtige Nachricht in
der Detailansicht. Konsole ohne Fehler.

## [2026-09-21] Nachtrag: Abwesenheitsassistent
(WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent", Web-UI --
Track A/Backend fertig in Commits `fc4e287`/`7215149`, siehe
`backend/README.md` "Signaturen & Abwesenheitsassistent" für die
serverseitige Ausloese-Logik, Sicherheits-Ausnahmen und den dabei
gefundenen/behobenen `mail-actions`-Packaging-Fehler.)

**Formular im Einstellungsbereich:** neuer Abschnitt "Abwesenheitsassistent"
in `SettingsModal.tsx` (zwischen "Sicherheit" und "Anleitung") -- Checkbox
"Automatische Antwort aktiv", Start-/Ende-Datumsfelder (`<input
type="date">`, Ende optional), Betreff- und Nachrichtentext-Felder,
gebunden an neue `api.getAbsenceResponder()`/`updateAbsenceResponder()`
(`GET`/`PUT /absence-responder`, neue `AbsenceResponder`-Typdefinition in
`types.ts`). **Bewusst ein einzelner "Speichern"-Button für das ganze
Formular** statt Sofort-Speichern pro Feld wie bei den übrigen
Settings-Toggles -- die Felder gehören inhaltlich zusammen (ein Aktivieren
ohne bereits eingetragenen Betreff wäre sonst serverseitig sofort ein
400). **Validierung läuft bewusst nicht client-seitig doppelt:** die drei
Pflichtfelder bei `active: true` (Start, Betreff, Text) werden nur einmal
serverseitig geprüft (`backend/src/routes/absenceResponder.ts`), die
resultierende 400-Fehlermeldung wird direkt im Formular angezeigt statt
dieselbe Regel zusätzlich im Client zu pflegen. Kein eigenes
Signatur-Feld hier -- die bestehende Default-Signatur des Kontos wird
serverseitig automatisch angehängt (siehe backend/README.md).

**Eigener Ladevorgang statt Prop-Synchronisation:** das Formular lädt
seinen Anfangszustand über einen eigenen `GET /absence-responder`-Aufruf
beim Öffnen des Dialogs (gleiches Prinzip wie das bestehende
`accentTheme`-Laden direkt darüber in derselben Datei) statt sich per
Effekt aus einer App.tsx-Prop zu synchronisieren -- letzteres hätte einen
`react(set-state-in-effect)`-Lint-Befund erzeugt (State-Zuweisung
synchron im Effekt-Body statt in einem `.then()`), ersteres passt genau
in die bestehende Konvention dieser Datei und bleibt warnungsfrei.

**Banner mit Schnellaktion:** `AbsenceResponderBanner.tsx` (neue
Komponente) -- rendert nur, wenn der Assistent aktiv ist, zeigt optional
das Enddatum, "Jetzt beenden" setzt per `PUT { active: false }`
ausschließlich das Aktiv-Flag (Datumsfelder/Betreff/Text bleiben
gespeichert, damit ein erneutes Aktivieren später das zuletzt eingetragene
Formular wiederfindet). Der Zustand lebt dafür zusätzlich in App.tsx
(eigener `GET /absence-responder`-Aufruf nach Login, unabhängig vom
Einstellungsdialog, damit der Banner auch sichtbar ist, ohne dass Settings
je geöffnet wurde) -- `SettingsModal.tsx` meldet ein erfolgreiches
Speichern über eine `onAbsenceResponderChange`-Callback-Prop dorthin
zurück, damit der Banner sofort mitzieht statt erst beim nächsten Laden.

**Layout-Anpassung:** `.app-shell` hat festes `height: 100vh` für den
(häufigeren) bannerlosen Fall. Mit aktivem Banner wird `.app-shell`
zusätzlich in einen neuen `.app-viewport`-Flex-Container (`height: 100vh`,
`flex-direction: column`) gehängt und bekommt dort `flex: 1` statt seiner
eigenen `height: 100vh` -- sonst hätte Banner-Höhe + `.app-shell`
zusammen mehr als einen Viewport beansprucht. Der Wrapper existiert nur,
wenn der Banner tatsächlich gerendert wird.

**Mock-Server:** neuer `GET`/`PUT /absence-responder`-Handler in
`mock-server/server.mjs`, gleiche Pflichtfeld-Validierung wie das
Backend (`badRequest()`-Helfer, bestehende Konvention dieser Datei --
liefert `{ error: "bad_request", message: "..." }`, anders als das echte
Backend, das die volle Meldung direkt in `.error` liefert; dieser
Unterschied besteht bereits bei jedem anderen `badRequest()`-Aufruf in
diesem Mock-Server und ist keine neue Abweichung).

**Tests:** `tsc -b`/`vite build`/`oxlint` grün (keine neuen Warnungen über
die bestehende Baseline hinaus). Per Browser-Automation gegen den
Mock-Server durchgeklickt: Aktivieren ohne Pflichtfelder zeigt die
400-Fehlermeldung im Formular; vollständiges Ausfüllen (Start 25.09.2026,
Betreff, Text) + Speichern zeigt den Banner sofort ohne Neuladen; "Jetzt
beenden" im Banner lässt ihn verschwinden UND per direktem `curl GET
/absence-responder` bestätigt, dass `active: false` server-seitig
tatsächlich gesetzt ist, während `startDate`/`subject`/`body` unverändert
erhalten blieben; erneutes Öffnen des Einstellungsbereichs zeigt das
Formular korrekt mit den zuvor gespeicherten (jetzt inaktiven) Werten
vorausgefüllt. Konsole ohne Fehler während des gesamten Durchlaufs.

## [2026-09-21] Nachtrag: Design-Richtung (Superhuman-Stil)

WEB_INBOX.md 21.09. "DESIGN-RICHTUNG - von Massimo bestaetigt" -- visuelle
Ueberarbeitung nach Massimos Recherche zu den bestbewerteten Mail-Clients
(Superhuman als Testsieger), von ihm per Mockup freigegeben. Reine
Layout-/CSS-Anpassung, kein Contract-Change, keine neue Logik ausser dem
Cmd/Ctrl+K-Kurzbefehl (siehe unten).

**1) Schmalere Sidebar** (`FolderSidebar.css`): 220px -> 188px, engere
Innenabstaende, das Brand-Label eine Stufe kleiner (`--font-size-heading`
-> `--font-size-body`), der dezente Schatten auf dem aktiven
Theme-Umschalter entfernt -- weniger visuelles Gewicht, wie im Auftrag
verlangt.

**2) Kompakte Listenzeilen** (`MessageList.css`): `.message-row` hatte
vorher Karten-Optik (Rahmen, `border-radius`, `box-shadow` im aktiven
Zustand, groszuegiges Padding). Jetzt: kein Rahmen/Schatten mehr, nur eine
duenne `border-bottom` als Trennlinie zur naechsten Zeile, engeres
vertikales Padding. Die ausgewaehlte Zeile bekommt statt Vollrahmen+Schatten
nur noch einen schlanken linken Akzent-Balken (2px) -- die Akzentfarbe
bleibt fuer die Auswahl-Markierung ausdruecklich erlaubt (siehe
"ERGAENZUNG zur Design-Richtung"), aber dezent genug, um nicht mit den
Sicherheits-Badges zu konkurrieren.

**3) Genau EIN Akzent pro Ansicht:** Repo-weite Pruefung (`grep` ueber alle
`components/*.css` nach Hex-Farben/`rgba(...)` ausserhalb von
`color-mix(...)`) ergab **keinen Fund** -- das bestehende Design-System
nutzt bereits durchgaengig nur die drei erlaubten Rollen
(`--color-accent`/`--color-danger`/`--color-warning`/`--color-success`),
keine zusaetzliche, hart codierte Farbe schlich sich irgendwo ein. Die
einzige noetige Aenderung war deshalb, die card-artigen Schatten/Raender
(Punkt 2) zu entfernen, die selbst zwar farbneutral waren, aber optisch
mit den Sicherheits-Badges um Aufmerksamkeit konkurrierten. Per Browser-
Test bestaetigt (siehe unten): `SecurityBadge` (Phishing-Verdacht,
Anzeigename gefaelscht, Antwort-Adresse weicht ab, IBAN im Verlauf
geaendert) bleibt das einzige farbig hervorstechende Element in Liste UND
Detailansicht.

**4) "Neue Nachricht"-Button:** bereits vorhanden (frueherer Compose-
Button-Fund), unveraendert -- passt bereits zur kompakteren Optik, kein
Umbau noetig.

**5) Cmd/Ctrl+K-Hinweis:** ausdruecklich "kein Muss fuer den ersten
Entwurf" -- bewusst NICHT als volles Befehlspaletten-Overlay gebaut,
sondern als kleine, funktionale Ergaenzung: ein dezenter `⌘K`-Hinweis in
der Sidebar (`.cmdk-hint`, `FolderSidebar.tsx`) plus ein echter globaler
`keydown`-Listener in `App.tsx`, der bei Cmd/Ctrl+K das bestehende
Suchfeld fokussiert (`searchInputRef`) -- kein neues UI-Konzept, nur ein
Shortcut auf eine bereits vorhandene Funktion.

**Bewusste Grenze:** der Auftrag nennt einen "dezenten Ungelesen-Punkt
links" als Teil der kompakten Listenzeile. Dafuer gibt es aktuell **keine
Grundlage im Contract** -- weder `Message` noch `MessageDetail` haben ein
Gelesen/Ungelesen-Feld (`api-spec.yaml`/`backend/src/types.ts` durchsucht,
kein Treffer), driftmail hat bisher ueberhaupt kein Lese-Tracking-Feature.
Ein rein client-seitiger Fake (z.B. `localStorage`-basiertes "gesehen"-
Set) waere irrefuehrend und wuerde bei mehreren Geraeten/Clients sofort
auseinanderlaufen -- deshalb bewusst weggelassen statt etwas Falsches
vorzutaeuschen. Ein echtes Gelesen/Ungelesen-Feature (neue Spalte +
Contract-Ergaenzung) waere ein eigener, separater Auftrag.

**Tests:** `tsc -b`/`vite build`/`oxlint` gruen, exakt die bestehende
6-Warnungen-Baseline (keine neuen). Per Browser-Automation gegen den
Mock-Server verifiziert: Sidebar sichtbar schmaler, Listenzeilen im
Eingang kompakt mit Trennlinien statt Karten, Quarantaene-Ordner zeigt
drei Mails mit klar farbig hervorgehobenem "Phishing-Verdacht"-Badge als
einzigem farbigen Element in der Zeile, ausgewaehlte Zeile zeigt den
schlanken Akzent-Balken statt Vollrahmen, Cmd+K fokussiert das Suchfeld
und liefert ein echtes Suchergebnis, Detailansicht einer Quarantaene-Mail
zeigt vier Sicherheits-Badges klar farbig neben durchgehend neutralen
Aktions-Buttons (Loeschen/Check Mail/Antworten/Weiterleiten). Konsole in
allen Schritten ohne Fehler.

## Annahmen / offene Punkte

- Es gibt in `api-spec.yaml` keinen eigenen "Liste der Quarantäne-Einträge
  inkl. Grund"-Endpoint (die `quarantine`-Tabelle mit `reason` und
  `auto_delete_at` aus `db-schema.sql` wird über keinen API-Endpoint
  exponiert). Um den Contract nicht eigenmächtig zu erweitern, zeigt die
  UI stattdessen die vorhandenen `SecurityResult`-Signale als Begründung.
  Das ist unter "Offene Fragen" in `SYNC.md` eingetragen.
- Für den Skeleton ist die Nachrichtenliste je Ordner in einem Rutsch
  geladen (kein Paging), passend zur überschaubaren Mock-Datenmenge
  (3 Nachrichten je Ordner).
- Responsive: Ab ~900px Breite fällt das 3-Spalten-Layout auf ein
  gestapeltes Layout zurück (einfache Anpassung, kein vollständiges
  Mobile-Redesign — das wäre ein Folgeschritt).
- Kein Drag&Drop zum Verschieben von Nachrichten zwischen Ordnern — das
  Dropdown "In Ordner verschieben…" in der Detailansicht deckt den
  Kernfluss ab (Contract-Endpoint `POST /messages/{id}/move` ist damit
  einmal end-to-end gezeigt), eine Drag&Drop-Interaktion in der Liste
  wäre ein sinnvoller nächster Schritt, aber nicht Teil dieses Skeletons.
- Ordner-Reihenfolge (`sortOrder`) ist über `PATCH /folders/{id}` im
  Mock-Server änderbar, aber es gibt noch keine Drag&Drop-/Pfeil-UI dafür
  in der Sidebar — neue Ordner hängen sich einfach hinten an.
- [2026-09-19] WEB_INBOX.md 15.09. "Verschlüsselung der lokalen Mail-
  Datenbank" geprüft: es gibt hier keine lokale Mail-Datenbank (Nachrichten
  leben nur im React-State, nie in `localStorage`/IndexedDB) — nichts zu
  verschlüsseln. Einzige lokal persistierte, sensible Größe ist der
  Session-Token in `localStorage` (`src/api.ts`), dazu eine ehrliche
  Grenzen-Doku direkt im Code (browserseitig per JS nicht sinnvoll
  nachrüstbar). Ausführlich in `ios/README.md` (Punkt 6 der "6 Sicherheits-
  Ergänzungen") und `SYNC.md` 19.09.

## Projektstruktur

```
web/
  mock-server/
    data.mjs       Beispieldaten (Accounts, Folders, Messages, Contracts)
    server.mjs      Node-http-Server, implementiert api-spec.yaml
  src/
    api.ts           Fetch-Client gegen den Mock-Server
    types.ts         TS-Typen, gespiegelt aus api-spec.yaml / ai-adapter-interface.ts
    folderMeta.ts     Client-Metadaten für System-Ordner (colorRole/muted/renamable),
                      gespiegelt aus design-tokens.json "systemFolders.defaults"
    tokens.css       Design-Tokens als CSS Custom Properties (hell/dunkel/system)
    useTheme.ts       Theme-Auswahl + Persistenz in localStorage
    useAppLock.ts     Web-Äquivalent zur iOS-App-Sperre (WebAuthn, rein lokal)
    icons.tsx         Kleines abhängigkeitsfreies Icon-Set (Ordner-Icons u.a.)
    components/
      OnboardingScreen.tsx/.css   Provider-Auswahl + IMAP-Formular (ersetzt LoginScreen)
      AppLockGate.tsx/.css        Sperrbildschirm-Wrapper für useAppLock
      FolderSidebar.tsx/.css   Ordner-Nav: laden/anlegen/umbenennen/löschen
      MessageList.tsx/.css
      DraftList.tsx/.css       "entwuerfe"-Ordner: Liste + Löschen (GET/DELETE /drafts)
      MessageDetailPane.tsx/.css   inkl. Senden + Anhang-Upload
      SecurityBadge.tsx/.css
    App.tsx/.css
```
