# driftmail — Web-Fallback-UI (Track F)

Web-App-Shell für driftmail: Inbox mit den Ordnern des Users (5 feste
System-Ordner + beliebig viele eigene Ordner, aus `GET /folders`),
Nachrichtenansicht mit Security-Badge, Quarantäne-Ansicht. Gestylt nach den
Design-Tokens (Farben, Typografie, Radius, Spacing), inkl.
Light-/Dark-/System-Theme.

Dies ist ein erster Durchstich (Skeleton), kein produktionsreifer Code.
Ziel: Kernfluss end-to-end zeigen, gegen denselben Mock-Server-Vertrag
wie Track C (iOS) arbeiten.

**Update 08.09. (Contract-Änderung "benutzerdefinierte Ordner", Commit
`734781e`):** Der feste 5er-Folder-Enum wurde durch echte `Folder`-Objekte
({id, name, icon, isSystem, systemKey, sortOrder}) ersetzt. Details im
Abschnitt "Ordner" weiter unten sowie in `SYNC.md` unter
"Contract-Änderungen".

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
  Endpunkte aus `contracts/api-spec.yaml` (`/accounts`, `/folders`,
  `/folders/{folderId}`, `/messages`, `/messages/{id}`,
  `/messages/{id}/quarantine`, `/messages/{id}/move`, `/messages/{id}/summary`,
  `/messages/{id}/reply-draft`, `/contracts`, `/contracts/{id}/confirm`,
  `/capability-check`) gegen statische Beispieldaten in `mock-server/data.mjs`.
  Mutationen (Ordner anlegen/umbenennen/löschen, Nachricht verschieben/in
  Quarantäne setzen, Contract bestätigen) wirken nur im Prozessspeicher und
  gehen beim Neustart verloren.
- **KI-Quelle ist immer `cloud_fallback`.** Laut Auftrag nutzt Web keine
  On-Device-KI (kein Browser-seitiges Modell). Der Mock-Server liefert in
  `MailSummary.source` konsequent `"cloud_fallback"`. Für
  `AiAdapterResult` aus `contracts/ai-adapter-interface.ts` gilt web-seitig
  dieselbe Annahme (die Interface-Datei selbst wird von Track A/B/D real
  implementiert, hier nur konsumiert).
- **Kein echter Mailversand.** Der "Antwortentwurf"-Button erzeugt einen
  Entwurf (editierbares Textfeld), der "Senden"-Button ist bewusst
  deaktiviert (Tooltip erklärt warum) — laut
  `ai-adapter-interface.ts`-Kommentar geht ein Entwurf "nie automatisch
  raus, immer Review/Edit/Send durch User", ein echter Versand ist für
  diesen Skeleton nicht im Scope.
- **Keine Authentifizierung/Login.** Es gibt genau ein Mock-Konto
  (`massimo@example.com`, Provider `gmail`), das beim Start geladen wird.
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
  verschieben", ein Dropdown "In Ordner verschieben…" (`POST
  /messages/{id}/move`, zeigt alle Ordner außer dem aktuellen), "Was
  wollen die von mir?" → `MailSummary`, "Antwortentwurf erstellen" →
  `draftText`).
- **Quarantäne-Ansicht:** ist kein separater Screen, sondern der
  System-Ordner mit `systemKey: "quarantaene"` in derselben
  Liste/Detail-Struktur. Die Detailansicht macht dort über das
  Security-Badge + die Sicherheits-Details transparent, warum eine
  Nachricht dort liegt (z. B. SPF/DKIM/DMARC fail, Homoglyph-Domain, neue
  IBAN im Text).

### Ordner (Contract-Update 08.09.)

- `Folder` ist jetzt ein Objekt (`{id, name, icon, isSystem, systemKey,
  sortOrder}`), keine feste String-Enum mehr. `Message.folderId` verweist
  per UUID auf einen `Folder` statt eines Enum-Werts.
- Mock-Daten: 5 System-Ordner (`is_system: true`, `system_key` wie zuvor
  die Enum-Werte: wichtig/sonstiges/rechnungen/quarantaene/spam) plus ein
  Beispiel-Ordner "Familie" (`is_system: false`, `system_key: null`) mit
  einer eigenen Beispiel-Nachricht, um zu zeigen, dass eigene Ordner
  vollwertig funktionieren.
- **Design-Entscheidung (08.09., Track F, nicht im Contract vorgegeben):**
  was passiert mit Nachrichten in einem gelöschten Ordner? `api-spec.yaml`
  sagt dazu nichts. Der Mock-Server verschiebt sie beim `DELETE
  /folders/{id}` nach "Sonstiges" statt sie zu verlieren (analog zum
  Verhalten vieler Mail-Clients). Reines Mock-Verhalten — Track A muss für
  das echte Backend entscheiden, ob das so übernommen wird oder ob z. B.
  eine Bestätigung/Warnung nötig ist, wenn der Ordner nicht leer ist.

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
    icons.tsx         Kleines abhängigkeitsfreies Icon-Set (Ordner-Icons u.a.)
    components/
      FolderSidebar.tsx/.css   Ordner-Nav: laden/anlegen/umbenennen/löschen
      MessageList.tsx/.css
      MessageDetailPane.tsx/.css
      SecurityBadge.tsx/.css
    App.tsx/.css
```
