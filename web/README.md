# driftmail — Web-Fallback-UI (Track F)

Web-App-Shell für driftmail: Inbox mit den 5 Ordnern aus
`contracts/design-tokens.json`, Nachrichtenansicht mit Security-Badge,
Quarantäne-Ansicht. Gestylt nach den Design-Tokens (Farben, Typografie,
Radius, Spacing), inkl. Light-/Dark-/System-Theme.

Dies ist ein erster Durchstich (Skeleton), kein produktionsreifer Code.
Ziel: Kernfluss end-to-end zeigen, gegen denselben Mock-Server-Vertrag
wie Track C (iOS) arbeiten.

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
  Endpunkte aus `contracts/api-spec.yaml` (`/accounts`, `/messages`,
  `/messages/{id}`, `/messages/{id}/quarantine`, `/messages/{id}/summary`,
  `/messages/{id}/reply-draft`, `/contracts`, `/contracts/{id}/confirm`,
  `/capability-check`) gegen statische Beispieldaten in `mock-server/data.mjs`.
  Mutationen (Quarantäne setzen, Contract bestätigen) wirken nur im
  Prozessspeicher und gehen beim Neustart verloren.
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

- **Sidebar (links):** die 5 Ordner aus `design-tokens.json.folders` in
  der dort vorgegebenen Reihenfolge (Wichtig, Sonstiges, Rechnungen,
  Quarantäne, Spam) mit Anzahl je Ordner, plus Theme-Switch
  (Hell/Dunkel/System — die drei Werte aus `design-tokens.json.meta.themes`).
  "Quarantäne" nutzt `colorRole: "danger"`, "Spam" ist `muted`, exakt wie
  im Contract markiert.
- **Mittlere Spalte:** Nachrichtenliste des aktiven Ordners. Nachrichten,
  die nicht `safe` klassifiziert sind, zeigen direkt in der Liste ein
  kompaktes Security-Badge.
- **Rechte Spalte:** Detailansicht der ausgewählten Nachricht mit großem
  Security-Badge, aufklappbaren Sicherheits-Details (SPF/DKIM/DMARC,
  Domain-Alter, Reputation, Homoglyph-Erkennung, Link-Mismatch,
  Dringlichkeits-Sprache, neue IBAN, Konfidenz — alle 11 Felder aus
  `SecurityResult`), Body-Text sowie Aktionen ("In Quarantäne
  verschieben", "Was wollen die von mir?" → `MailSummary`,
  "Antwortentwurf erstellen" → `draftText`).
- **Quarantäne-Ansicht:** ist kein separater Screen, sondern der Ordner
  `quarantaene` in derselben Liste/Detail-Struktur — das ist einer der 5
  Ordner im Contract, kein Extra-Endpoint. Die Detailansicht macht dort
  über das Security-Badge + die Sicherheits-Details transparent, warum
  eine Nachricht dort liegt (z. B. SPF/DKIM/DMARC fail, Homoglyph-Domain,
  neue IBAN im Text).

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

## Projektstruktur

```
web/
  mock-server/
    data.mjs       Beispieldaten (Accounts, Messages, Contracts)
    server.mjs      Node-http-Server, implementiert api-spec.yaml
  src/
    api.ts           Fetch-Client gegen den Mock-Server
    types.ts         TS-Typen, gespiegelt aus api-spec.yaml / ai-adapter-interface.ts
    tokens.css       Design-Tokens als CSS Custom Properties (hell/dunkel/system)
    useTheme.ts       Theme-Auswahl + Persistenz in localStorage
    icons.tsx         Kleines abhängigkeitsfreies Icon-Set (Ordner-Icons u.a.)
    components/
      FolderSidebar.tsx/.css
      MessageList.tsx/.css
      MessageDetailPane.tsx/.css
      SecurityBadge.tsx/.css
    App.tsx/.css
```
