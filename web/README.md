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
