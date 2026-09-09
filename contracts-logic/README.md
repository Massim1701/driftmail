# contracts-logic — Track D: Vertragserkennung & Reminder-Logik

Eigenständiges TypeScript-Modul für driftmail, implementiert gegen den
Track-0-Contract (`contracts/ai-adapter-interface.ts`,
`contracts/db-schema.sql`). Läuft unabhängig von iOS-UI und Backend-API.

## Was ist drin

- **`src/extractContract.ts`** — `extractContract(rawText): Promise<ContractData | null>`
  aus dem `AiAdapter`-Interface. Regelbasierte/heuristische Erkennung von
  Anbietername, Vertragsbeginn/-ende, Kündigungsfrist/-datum und einem
  Konfidenz-Score. **Kein LLM, kein echtes KI-Modell** — siehe Abschnitt
  "Wo echte KI reinkäme" unten.
- **`src/scheduler.ts`** — `runReminderCheck(db, options)`: ein
  Scheduler-Durchlauf ("ein Tag Cron"), der fällige `reminders` findet,
  `snoozed_until` respektiert, `sent` setzt und optional einen
  Zustell-Callback (`onDue`) aufruft. Plus `startDailyReminderScheduler`
  für einen simplen Dauerlauf-Modus.
- **`src/db.ts`** — SQLite-Zugriffsschicht (`better-sqlite3`) für die
  Tabellen `contracts` und `reminders`, 1:1 an `contracts/db-schema.sql`
  angelehnt.
- **`src/schedulerCli.ts`** — CLI zum manuellen/produktiven Ausführen
  (`npm run scheduler:once` / `npm run scheduler:daemon`).
- **`test/`** — Vitest-Tests für Extraktion und Scheduler (14 Tests).

## Setup & Tests

```bash
cd contracts-logic
npm install
npm test          # einmaliger Testlauf
npm run test:watch
npm run build      # tsc -> dist/
```

## Scheduler manuell ausprobieren

```bash
# einmaliger Check gegen eine lokale SQLite-Datei
DRIFTMAIL_SQLITE_PATH=./dev.sqlite3 npm run scheduler:once

# Dauerlauf (Check sofort, danach alle 24h)
DRIFTMAIL_SQLITE_PATH=./dev.sqlite3 npm run scheduler:daemon
```

Ohne gesetzte Env-Var wird `./contracts-logic.sqlite3` im aktuellen
Arbeitsverzeichnis verwendet. Beim ersten Lauf werden `contracts`- und
`reminders`-Tabellen automatisch angelegt (siehe `openDb` in `src/db.ts`).

## Annahmen & bewusste Vereinfachungen

- **SQLite statt Postgres.** Für den ersten Durchstich reicht SQLite lokal.
  Tabellenform ist bewusst an `contracts/db-schema.sql` angelehnt
  (camelCase in TS, snake_case in der DB). Abweichungen: UUIDs werden per
  `crypto.randomUUID()` in der App erzeugt (statt `gen_random_uuid()` in
  der DB), `BOOLEAN` wird als `INTEGER` (0/1) gespeichert, `TIMESTAMPTZ`/
  `DATE` als ISO-8601-Text (UTC). Ein Postgres-Backend (Track A) kann
  dieselben Funktionssignaturen (`insertContract`, `findDueReminders`, …)
  mit einer `pg`-basierten Implementierung austauschen.
- **Nur `contracts`/`reminders` in `db.ts` angelegt**, nicht das komplette
  Schema — die anderen Tabellen sind für Track D nicht relevant.
- **`extractContract` gibt `null` zurück**, wenn der Text *gar kein*
  Vertragssignal enthält (kein Datum, keine erkennbare Firma, keine
  Kündigungsfrist-Formulierung). Sonst wird immer ein `ContractData`
  geliefert, ggf. mit vielen `null`-Feldern und niedrigem
  `extractedConfidence` — die Entscheidung "Review-Schritt ja/nein" liegt
  bei der UI (Track C/F), nicht hier. Als Orientierungswert ist
  `LOW_CONFIDENCE_THRESHOLD = 0.6` in `src/types.ts` definiert (nicht Teil
  des Track-0-Contracts, siehe SYNC.md "Offene Fragen").
- **`src/types.ts` dupliziert** die für Track D relevanten Typen aus
  `contracts/ai-adapter-interface.ts` und `contracts/db-schema.sql`,
  statt sie relativ zu importieren — es gibt (Stand jetzt) kein
  installierbares gemeinsames Package für `contracts/`. Bei Änderungen an
  den Contract-Dateien muss `src/types.ts` manuell nachgezogen werden.
- **Zustellung (Push/E-Mail/In-App-Badge) ist nicht Teil von Track D.**
  `runReminderCheck` nimmt einen `onDue`-Callback entgegen; wirft der
  Callback, bleibt der Reminder `sent = false` und wird beim nächsten Lauf
  erneut versucht (kein Datenverlust bei fehlgeschlagenem Versand).
- **Scheduler-Deployment:** `startDailyReminderScheduler` ist ein simpler
  `setInterval`-Dauerlauf für lokale Tests/erste Demos. Für Produktion
  eignet sich eher ein externer Trigger (OS-Cron, `node-cron`, Postgres
  `pg_cron`, Cloud-Scheduler) gegen `runReminderCheck` — die Funktion ist
  bewusst so geschnitten, dass sie sich für beides eignet.

## Wo echte KI-Extraktion reinkäme

`src/extractContract.ts` markiert die Stelle explizit mit dem Kommentar
`AI EXTRACTION HOOK`. Die heutige Heuristik:

- erkennt Anbieternamen nur über Label-Muster (`Anbieter:`, `Vertragspartner:`),
  Rechtsform-Suffixe (GmbH, AG, KG, Ltd., …) oder die Signaturzeile nach
  "Mit freundlichen Grüßen" — keine echte Named-Entity-Recognition.
- erkennt Daten nur in den Formaten `DD.MM.YYYY`, `YYYY-MM-DD` und
  "1. Januar 2026" — keine relativen Angaben ("in drei Monaten"), keine
  englischsprachigen Formate, keine mehrdeutigen Fälle.
- erkennt Kündigungsfristen nur über feste Signalwörter in Tagen/Wochen/
  Monaten in unmittelbarer Nähe des Wortes "Kündigung(sfrist)"/"kündbar".
- vergibt Konfidenz-Scores additiv pro gefundenem Feld, nicht modellbasiert
  — daher künstlich auf 0.95 gedeckelt (1.0 bleibt echter KI-Extraktion
  vorbehalten).

Eine echte Implementierung würde `rawText` an ein LLM geben (on-device
oder `cloud_fallback`, siehe `AiAdapterResult<T>.source` im Contract) mit
einem Structured-Output-Prompt passend zum `ContractData`-Schema, und die
Heuristik hier bestenfalls als Offline-/Quota-Fallback behalten (siehe
`ai_provider_config` in `db-schema.sql`).

## Nicht in diesem Track

- Kein Endpoint/Route (`/contracts`, `/contracts/{id}/confirm` aus
  `api-spec.yaml`) — das ist Track A/Backend.
- Kein UI-Review-Screen für niedrige Konfidenz — Track C (iOS) / F (Web).
- Keine echte Push-/Mail-Zustellung für fällige Reminder — Callback-Stelle
  ist vorbereitet (`onDue` in `runReminderCheck`).
