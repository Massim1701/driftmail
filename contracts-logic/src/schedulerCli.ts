// Track D — CLI zum manuellen/produktiven Ausführen des Reminder-Schedulers.
//
// Nutzung:
//   npm run scheduler:once            # ein einzelner Check-Durchlauf, dann Exit
//   npm run scheduler:daemon          # Dauerlauf, alle 24h ein Check
//
// DB-Pfad über Umgebungsvariable DRIFTMAIL_SQLITE_PATH (Standard:
// ./contracts-logic.sqlite3 im aktuellen Arbeitsverzeichnis). Für Postgres/
// Produktivbetrieb siehe README — db.ts müsste dafür durch eine
// pg-basierte Implementierung mit gleicher Funktionssignatur ersetzt werden.

import { openDb } from "./db.js";
import { runReminderCheck, startDailyReminderScheduler, type DueReminder } from "./scheduler.js";

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), ...args);
}

async function main() {
  const mode = process.argv.includes("--daemon") ? "daemon" : "once";
  const dbPath = process.env.DRIFTMAIL_SQLITE_PATH ?? "./contracts-logic.sqlite3";
  const db = openDb(dbPath);

  const onDue = (due: DueReminder) => {
    // Platzhalter für echte Zustellung (Push/E-Mail/In-App) — siehe scheduler.ts.
    log(
      "Reminder fällig:",
      due.reminder.id,
      "Vertrag:",
      due.contract?.providerName ?? "(unbekannt)"
    );
  };

  if (mode === "once") {
    const result = await runReminderCheck(db, { onDue });
    log(`Check fertig: ${result.sent.length} gesendet, ${result.failed.length} fehlgeschlagen.`);
    db.close();
    process.exit(result.failed.length > 0 ? 1 : 0);
  } else {
    log(`Scheduler-Daemon gestartet, DB: ${dbPath}, Intervall: 24h`);
    const handle = startDailyReminderScheduler(db, {
      onDue,
      onResult: (result) =>
        log(`Check fertig: ${result.sent.length} gesendet, ${result.failed.length} fehlgeschlagen.`),
      onError: (error) => log("Scheduler-Fehler:", error),
    });
    process.on("SIGINT", () => {
      log("SIGINT empfangen, stoppe Scheduler.");
      handle.stop();
      db.close();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      log("SIGTERM empfangen, stoppe Scheduler.");
      handle.stop();
      db.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
