import { beforeEach, describe, expect, it } from "vitest";
import { openDb, insertContract, insertReminder, getReminder } from "../src/db.js";
import { runReminderCheck } from "../src/scheduler.js";
import type { DriftmailDb } from "../src/db.js";

const REF_NOW = new Date("2026-09-08T12:00:00.000Z");

function isoOffset(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let db: DriftmailDb;

beforeEach(() => {
  db = openDb(":memory:");
  const contract = insertContract(db, {
    userId: "user-1",
    messageId: "msg-1",
    providerName: "Musterstrom GmbH",
    contractStart: "2026-01-01",
    contractEnd: "2027-01-01",
    cancellationDeadline: "2026-11-01",
    cancellationPeriodDays: 60,
    extractedConfidence: 0.8,
  });
  // Stash contract id on db for reuse in tests via closure
  (db as any)._testContractId = contract.id;
});

function contractId(): string {
  return (db as any)._testContractId as string;
}

describe("runReminderCheck", () => {
  it("marks a due, unsnoozed reminder as sent and reports it via onDue", async () => {
    const reminder = insertReminder(db, {
      contractId: contractId(),
      remindAt: isoOffset(REF_NOW, -HOUR), // 1h in the past -> due
    });

    const onDueCalls: string[] = [];
    const result = await runReminderCheck(db, {
      now: REF_NOW,
      onDue: (due) => {
        onDueCalls.push(due.reminder.id);
      },
    });

    expect(result.dueCount).toBe(1);
    expect(result.sent).toHaveLength(1);
    expect(onDueCalls).toEqual([reminder.id]);
    expect(getReminder(db, reminder.id)!.sent).toBe(true);
  });

  it("ignores reminders that are not due yet", async () => {
    insertReminder(db, {
      contractId: contractId(),
      remindAt: isoOffset(REF_NOW, HOUR), // 1h in the future
    });

    const result = await runReminderCheck(db, { now: REF_NOW });

    expect(result.dueCount).toBe(0);
    expect(result.sent).toHaveLength(0);
  });

  it("ignores reminders that are snoozed into the future, even if remind_at is due", async () => {
    const reminder = insertReminder(db, {
      contractId: contractId(),
      remindAt: isoOffset(REF_NOW, -DAY),
      snoozedUntil: isoOffset(REF_NOW, HOUR), // snoozed past `now`
    });

    const result = await runReminderCheck(db, { now: REF_NOW });

    expect(result.dueCount).toBe(0);
    expect(getReminder(db, reminder.id)!.sent).toBe(false);
  });

  it("fires a reminder whose snooze has already elapsed", async () => {
    const reminder = insertReminder(db, {
      contractId: contractId(),
      remindAt: isoOffset(REF_NOW, -DAY),
      snoozedUntil: isoOffset(REF_NOW, -HOUR), // snooze elapsed
    });

    const result = await runReminderCheck(db, { now: REF_NOW });

    expect(result.dueCount).toBe(1);
    expect(getReminder(db, reminder.id)!.sent).toBe(true);
  });

  it("never re-sends an already-sent reminder", async () => {
    const reminder = insertReminder(db, {
      contractId: contractId(),
      remindAt: isoOffset(REF_NOW, -DAY),
      sent: true,
    });

    const result = await runReminderCheck(db, { now: REF_NOW });

    expect(result.dueCount).toBe(0);
    expect(getReminder(db, reminder.id)!.sent).toBe(true);
  });

  it("keeps a reminder unsent if the onDue delivery callback throws", async () => {
    const reminder = insertReminder(db, {
      contractId: contractId(),
      remindAt: isoOffset(REF_NOW, -HOUR),
    });

    const result = await runReminderCheck(db, {
      now: REF_NOW,
      onDue: () => {
        throw new Error("push notification service down");
      },
    });

    expect(result.sent).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(getReminder(db, reminder.id)!.sent).toBe(false);
  });

  it("processes multiple due reminders across different contracts", async () => {
    const contract2 = insertContract(db, {
      userId: "user-1",
      messageId: "msg-2",
      providerName: "Fitnessstudio Nord",
      contractStart: null,
      contractEnd: null,
      cancellationDeadline: null,
      cancellationPeriodDays: null,
      extractedConfidence: null,
    });

    insertReminder(db, { contractId: contractId(), remindAt: isoOffset(REF_NOW, -HOUR) });
    insertReminder(db, { contractId: contract2.id, remindAt: isoOffset(REF_NOW, -2 * HOUR) });
    insertReminder(db, { contractId: contract2.id, remindAt: isoOffset(REF_NOW, HOUR) }); // not due

    const result = await runReminderCheck(db, { now: REF_NOW });

    expect(result.dueCount).toBe(2);
    expect(result.sent.map((s) => s.contract?.providerName).sort()).toEqual(
      ["Fitnessstudio Nord", "Musterstrom GmbH"].sort()
    );
  });
});
