// Track D — Reminder-Scheduler-Job
//
// Täglicher (oder beliebig oft aufrufbarer) Check gegen die reminders-
// Tabelle: findet fällige Reminder, markiert sie als gesendet, respektiert
// snoozed_until. Das eigentliche Zustellen (Push-Notification, E-Mail,
// In-App-Badge, ...) ist NICHT Teil von Track D — dafür nimmt
// runReminderCheck einen onDue-Callback entgegen, den z.B. Track A
// (Backend) oder Track C (iOS) mit echtem Notification-Code füllt.

import type { DriftmailDb } from "./db.js";
import { findDueReminders, markReminderSent, getContract } from "./db.js";
import type { ContractRow, ReminderRow } from "./types.js";

export interface DueReminder {
  reminder: ReminderRow;
  contract: ContractRow | null;
}

export interface RunReminderCheckOptions {
  /** Referenzzeitpunkt, Standard: jetzt. In Tests explizit setzen. */
  now?: Date;
  /**
   * Wird pro fälligem Reminder aufgerufen, BEVOR er als `sent` markiert
   * wird. Wirft der Callback, bleibt der Reminder unsent (kein Datenverlust
   * bei fehlgeschlagenem Versand) und wird beim nächsten Lauf erneut
   * versucht.
   */
  onDue?: (due: DueReminder) => void | Promise<void>;
}

export interface RunReminderCheckResult {
  checkedAt: string; // ISO
  dueCount: number;
  sent: DueReminder[];
  failed: Array<{ reminder: ReminderRow; error: unknown }>;
}

/**
 * Ein einzelner Scheduler-Durchlauf ("ein Tag Cron"). Idempotent im
 * Rahmen von `now`: bereits gesendete Reminder (sent = true) werden nie
 * wieder zurückgesetzt oder erneut gemeldet.
 */
export async function runReminderCheck(
  db: DriftmailDb,
  options: RunReminderCheckOptions = {}
): Promise<RunReminderCheckResult> {
  const now = options.now ?? new Date();
  const due = findDueReminders(db, now);

  const sent: DueReminder[] = [];
  const failed: Array<{ reminder: ReminderRow; error: unknown }> = [];

  for (const reminder of due) {
    const contract = getContract(db, reminder.contractId);
    const dueReminder: DueReminder = { reminder, contract };
    try {
      if (options.onDue) {
        await options.onDue(dueReminder);
      }
      markReminderSent(db, reminder.id);
      sent.push(dueReminder);
    } catch (error) {
      failed.push({ reminder, error });
    }
  }

  return {
    checkedAt: now.toISOString(),
    dueCount: due.length,
    sent,
    failed,
  };
}

export interface DaemonHandle {
  stop: () => void;
}

/**
 * Startet den Scheduler als Dauerlauf-Prozess, der `runReminderCheck` alle
 * `intervalMs` ausführt (Standard: 24h, wie ein täglicher Cron-Job).
 *
 * Für echten Produktivbetrieb ist ein externer Scheduler (OS-Cron,
 * node-cron, Postgres pg_cron, Cloud-Scheduler o.ä.) meist robuster als ein
 * dauerhaft laufender setInterval-Prozess — diese Funktion ist der
 * einfachste gemeinsame Nenner für den ersten Durchstich und lokale Tests.
 * Siehe README für Deployment-Optionen.
 */
export function startDailyReminderScheduler(
  db: DriftmailDb,
  options: RunReminderCheckOptions & {
    intervalMs?: number;
    onResult?: (result: RunReminderCheckResult) => void;
    onError?: (error: unknown) => void;
  } = {}
): DaemonHandle {
  const intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000;

  const tick = () => {
    runReminderCheck(db, options)
      .then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error));
  };

  tick(); // sofort einmal laufen lassen, dann im Intervall
  const timer = setInterval(tick, intervalMs);
  // Verhindert, dass ein laufender Timer allein den Prozess am Leben hält
  // (Node-Idiom, für CLI-Nutzung ohne .unref() unerwünscht — daher nicht
  // hier, sondern bewusst dem Aufrufer überlassen).

  return {
    stop: () => clearInterval(timer),
  };
}
