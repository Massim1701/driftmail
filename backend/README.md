# driftmail-backend (Track A)

Erster Durchstich der Backend-API gegen `contracts/api-spec.yaml` und
`contracts/db-schema.sql`. Zeigt den Kernfluss end-to-end:

```
Mail-Adapter (Gmail/IMAP/Fixture) -> Sync-Pipeline -> Mock-KI-Analyse
  -> Ordner-Zuordnung + ggf. Auto-Quarantäne -> API (GET/POST wie im Contract)
```

Node/TypeScript + Express. Kein produktionsreifer Code, sondern ein
startbares, testbares Skeleton für den ersten Track-übergreifenden
Durchstich.

## Starten

```bash
npm install
npm run dev        # tsx watch, http://localhost:3000
# oder:
npm run build && npm start
```

Ohne jede Konfiguration synct der Server beim Start automatisch ein
Demo-Konto gegen den **Fixture-Mail-Adapter** (4 Beispiel-Mails: normale
Mail, Phishing-Versuch, Spam-Newsletter, Vertragsmail) und läuft sofort
end-to-end durch — kein Postgres, kein Google/IMAP-Setup nötig.

- API-Basis (Contract, `servers[0].url` in `api-spec.yaml` ist
  `/v1`-relativ): `http://localhost:3000/v1`
- Health-Check: `GET http://localhost:3000/health`
- Manuellen Sync erneut anstoßen: `POST http://localhost:3000/internal/sync`

## Testen

```bash
npm test
```

Das ist ein End-to-End-Smoketest ohne Testframework
(`src/smoketest.ts`): startet die App in-process, synct das Fixture-Konto
und durchläuft den kompletten Kernfluss über echte HTTP-Requests —
`/v1/accounts`, `/v1/messages` (inkl. `folder`-Filter), `/v1/messages/:id`,
`/v1/messages/:id/summary`, `/v1/messages/:id/reply-draft`,
`/v1/messages/:id/quarantine`, `/v1/contracts`,
`/v1/contracts/:id/confirm`, `/v1/capability-check`. Bricht mit
Fehlermeldung ab, sobald eine Response nicht zum erwarteten Contract-Format
passt.

Manuell durchprobieren z.B. mit:

```bash
curl http://localhost:3000/v1/messages | jq
curl http://localhost:3000/v1/messages?folder=spam | jq
curl -X POST http://localhost:3000/v1/capability-check \
  -H 'Content-Type: application/json' \
  -d '{"platform":"web","onDeviceSupported":false,"activeMode":"cloud_fallback"}'
```

## Was ist echt, was ist Mock/Stub

**Echt implementiert:**
- Express-API 1:1 gegen `contracts/api-spec.yaml` (alle Pfade, unter `/v1`
  gemountet, camelCase-Response-Shapes wie in der Spec).
- Gmail-Adapter (`src/mail/gmailAdapter.ts`, via `googleapis`) — echte
  Gmail-API-Calls, wenn `GMAIL_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN` in der
  Umgebung gesetzt sind.
- IMAP-Adapter (`src/mail/imapAdapter.ts`, via `imapflow` + `mailparser`)
  — echte IMAP-Verbindung, wenn `IMAP_HOST`/`_USER`/`_PASSWORD` gesetzt
  sind.
- Sync-Pipeline (`src/mail/sync.ts`): Dedupe über
  `(mail_account_id, message_id_header)` wie im Schema (`UNIQUE`-Constraint
  auf `messages`), Ordner-Zuordnung, Auto-Quarantäne bei
  `classification === "phishing"`.

**Mock/Stub (bewusst, siehe Auftrag):**
- **KI-Logik** (`src/ai/mockAdapter.ts`): implementiert
  `contracts/ai-adapter-interface.ts` vollständig, aber mit simplen
  Keyword-Heuristiken statt echter Klassifikation/Extraktion — liefert
  plausible Beispieldaten. Track B (Sicherheits-Klassifikation) und Track D
  (Vertrag & Reminder) ersetzen das später; der Austausch betrifft nur
  `src/ai/index.ts` (eine Zeile), da Routen/Sync-Pipeline ausschließlich
  gegen das `AiAdapter`-Interface arbeiten.
- **Fixture-Mail-Adapter** (`src/mail/fixtureAdapter.ts`): Standardpfad
  ohne echte Zugangsdaten, damit das Skeleton ohne Setup läuft und
  testbar ist (siehe "Annahmen" unten).
- **Persistenz**: In-Memory-Store (`src/db/store.ts`) statt echtem
  Postgres, siehe "Annahmen".
- **Auth**: keine — kein Login/Session/Token-Handling in diesem
  Durchstich, ein fester "Demo-User" wird beim Start angelegt.

## Annahmen (nicht selbst im Contract entscheidbar, siehe SYNC.md)

- `contracts/db-schema.sql` ist Postgres-DDL, aber ein DB-Server war nicht
  Teil des Auftrags/Setups. Für den ersten Durchstich wurde eine
  In-Memory-Repository-Schicht mit identischen Feldern/Typen gebaut
  (`src/db/store.ts`). Der Wechsel auf echtes Postgres (z.B. mit `pg`)
  sollte nur dieses eine Modul betreffen, da Routen/Sync-Pipeline nur
  gegen die Store-Methoden arbeiten, nicht gegen SQL direkt.
- Kein Auth/Multi-User-Handling: `api-spec.yaml` enthält keine
  Auth-Parameter (kein `userId` in Pfaden/Query), daher arbeitet dieses
  Skeleton mit einem einzigen Demo-User (`ensureDemoUser()` in
  `src/db/store.ts`), analog zu `POST /capability-check`, dessen Body
  laut Contract ebenfalls kein `userId`-Feld hat.
- Gmail-OAuth-Consent-Flow (Autorisierung durch den End-User) ist nicht
  Teil dieses Durchstichs — der Adapter erwartet ein bereits vorhandenes
  Refresh-Token. Der eigentliche OAuth-Flow (Redirect/Callback-Route) ist
  ein späterer Schritt.
- Kein Hintergrund-Job/Webhook (Gmail Push, IMAP IDLE) — Sync läuft beim
  Serverstart und on-demand über `POST /internal/sync`
  (`src/routes/internal.ts`, **kein** Contract-Bestandteil, nur
  Betriebs-/Testhilfe für diesen Durchstich).
- `unsubscribe_actions`, `message_links`, `reminders`, `signatures`,
  `security_audit_log`, `ai_provider_config` existieren in
  `db-schema.sql`, haben aber (noch) keine Entsprechung in
  `api-spec.yaml`. Nicht in diesem Durchstich implementiert — siehe
  "Offene Fragen" in `SYNC.md`.

## Struktur

```
src/
  app.ts              Express-App, Router-Mounting (/v1 = Contract, sonst intern)
  index.ts             Serverstart + initialer Sync
  types.ts             interne Modelle + API-Shapes (Spiegel von db-schema.sql / api-spec.yaml)
  mappers.ts            interne Records -> API-Response-Shapes
  routes/               ein Router-Modul je api-spec.yaml-Ressource + internal.ts (Health/Sync/Seed)
  db/store.ts           In-Memory-Repository (siehe "Annahmen")
  mail/                 MailAdapter-Interface + Gmail/IMAP/Fixture-Implementierungen + Sync-Pipeline
  ai/                   AiAdapter-Interface (Spiegel von ai-adapter-interface.ts) + Mock-Implementierung
  smoketest.ts           End-to-End-Test (npm test)
```
