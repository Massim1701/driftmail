// Track D — DB-Zugriffsschicht für contracts/reminders.
//
// Für den ersten Durchstich läuft das gegen SQLite (better-sqlite3), lokal
// testbar ohne externe Abhängigkeit. Tabellenform ist bewusst 1:1 an
// contracts/db-schema.sql (Postgres) angelehnt — camelCase in TS, snake_case
// in der DB, wie beim Rest des Schemas üblich.
//
// Abweichungen zu Postgres (dokumentiert, siehe README "Annahmen"):
//  - UUIDs werden in der App per crypto.randomUUID() erzeugt statt per
//    gen_random_uuid() der DB (SQLite kann das nicht nativ).
//  - BOOLEAN wird als INTEGER (0/1) gespeichert (SQLite-Konvention).
//  - TIMESTAMPTZ/DATE werden als ISO-8601-TEXT gespeichert (UTC).
//  - Nur die für Track D relevanten Tabellen (contracts, reminders) werden
//    hier angelegt, nicht das komplette db-schema.sql. In Produktion laufen
//    beide Tracks (Track D hier, Track A/Backend fürs echte Postgres)
//    gegen dasselbe migrierte Schema — dieses db.ts ist nur die lokale
//    Test-/Dev-Variante.
//
// Ein echtes Postgres-Backend (Track A) kann dieselben Funktionen mit einer
// pg-basierten Implementierung austauschen, solange die Signaturen gleich
// bleiben (ContractStore-Interface unten).

import Database from "better-sqlite3";
import type { ContractRow, ContractStatus, ReminderRow } from "./types.js";

export type DriftmailDb = Database.Database;

/** Öffnet (und legt bei Bedarf an) eine SQLite-DB mit dem Track-D-Teilschema. */
export function openDb(filename: string = ":memory:"): DriftmailDb {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      contract_start TEXT,
      contract_end TEXT,
      cancellation_deadline TEXT,
      cancellation_period_days INTEGER,
      status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (status IN ('active', 'cancelled', 'expired', 'needs_review')),
      extracted_confidence REAL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      remind_at TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      snoozed_until TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_due
      ON reminders (sent, remind_at);
  `);
  return db;
}

function rowToContract(row: any): ContractRow {
  return {
    id: row.id,
    userId: row.user_id,
    messageId: row.message_id,
    providerName: row.provider_name,
    contractStart: row.contract_start,
    contractEnd: row.contract_end,
    cancellationDeadline: row.cancellation_deadline,
    cancellationPeriodDays: row.cancellation_period_days,
    status: row.status as ContractStatus,
    extractedConfidence: row.extracted_confidence,
  };
}

function rowToReminder(row: any): ReminderRow {
  return {
    id: row.id,
    contractId: row.contract_id,
    remindAt: row.remind_at,
    sent: !!row.sent,
    snoozedUntil: row.snoozed_until,
  };
}

export interface InsertContractInput {
  id?: string;
  userId: string;
  messageId: string;
  providerName: string;
  contractStart: string | null;
  contractEnd: string | null;
  cancellationDeadline: string | null;
  cancellationPeriodDays: number | null;
  status?: ContractStatus;
  extractedConfidence: number | null;
}

export function insertContract(db: DriftmailDb, input: InsertContractInput): ContractRow {
  const id = input.id ?? crypto.randomUUID();
  const status = input.status ?? "needs_review";
  db.prepare(
    `INSERT INTO contracts
      (id, user_id, message_id, provider_name, contract_start, contract_end,
       cancellation_deadline, cancellation_period_days, status, extracted_confidence)
     VALUES (@id, @userId, @messageId, @providerName, @contractStart, @contractEnd,
       @cancellationDeadline, @cancellationPeriodDays, @status, @extractedConfidence)`
  ).run({ ...input, id, status });
  return getContract(db, id)!;
}

export function getContract(db: DriftmailDb, id: string): ContractRow | null {
  const row = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id);
  return row ? rowToContract(row) : null;
}

export interface InsertReminderInput {
  id?: string;
  contractId: string;
  remindAt: string;
  sent?: boolean;
  snoozedUntil?: string | null;
}

export function insertReminder(db: DriftmailDb, input: InsertReminderInput): ReminderRow {
  const id = input.id ?? crypto.randomUUID();
  db.prepare(
    `INSERT INTO reminders (id, contract_id, remind_at, sent, snoozed_until)
     VALUES (@id, @contractId, @remindAt, @sent, @snoozedUntil)`
  ).run({
    id,
    contractId: input.contractId,
    remindAt: input.remindAt,
    sent: input.sent ? 1 : 0,
    snoozedUntil: input.snoozedUntil ?? null,
  });
  return getReminder(db, id)!;
}

export function getReminder(db: DriftmailDb, id: string): ReminderRow | null {
  const row = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id);
  return row ? rowToReminder(row) : null;
}

/**
 * Fällige, noch nicht gesendete Reminder zu einem Referenzzeitpunkt `now`.
 * "Fällig" heißt: remind_at <= now UND (kein Snooze ODER snoozed_until <= now).
 */
export function findDueReminders(db: DriftmailDb, now: Date = new Date()): ReminderRow[] {
  const nowIso = now.toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM reminders
       WHERE sent = 0
         AND remind_at <= @now
         AND (snoozed_until IS NULL OR snoozed_until <= @now)
       ORDER BY remind_at ASC`
    )
    .all({ now: nowIso });
  return rows.map(rowToReminder);
}

export function markReminderSent(db: DriftmailDb, id: string): void {
  db.prepare(`UPDATE reminders SET sent = 1 WHERE id = ?`).run(id);
}

export function snoozeReminder(db: DriftmailDb, id: string, until: Date): void {
  db.prepare(`UPDATE reminders SET snoozed_until = ? WHERE id = ?`).run(
    until.toISOString(),
    id
  );
}
