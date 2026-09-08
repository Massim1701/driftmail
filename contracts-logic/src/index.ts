// Track D — öffentliches Modul-Interface

export { extractContract } from "./extractContract.js";
export {
  runReminderCheck,
  startDailyReminderScheduler,
  type DueReminder,
  type RunReminderCheckOptions,
  type RunReminderCheckResult,
  type DaemonHandle,
} from "./scheduler.js";
export {
  openDb,
  insertContract,
  getContract,
  insertReminder,
  getReminder,
  findDueReminders,
  markReminderSent,
  snoozeReminder,
  type DriftmailDb,
  type InsertContractInput,
  type InsertReminderInput,
} from "./db.js";
export type {
  ContractData,
  ContractRow,
  ContractStatus,
  ReminderRow,
} from "./types.js";
export { LOW_CONFIDENCE_THRESHOLD } from "./types.js";
