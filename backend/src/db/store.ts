// In-Memory-Datenhaltung für diesen ersten Durchstich.
//
// ANNAHME (siehe README): contracts/db-schema.sql ist Postgres-DDL. Damit
// dieses Skeleton ohne Datenbank-Setup läuft und andere Tracks sofort
// dagegen testen können, hält dieses Modul die Daten im Prozessspeicher,
// aber mit exakt den Feldern/Typen aus dem Schema. Die Store-Methoden
// (list/get/insert je Tabelle) sind absichtlich so geschnitten, dass ein
// Ersatz durch eine echte Postgres-Anbindung (z.B. mit `pg`) nur dieses
// eine Modul betrifft — Routen und Sync-Pipeline bleiben unverändert.

import { randomUUID } from "node:crypto";
import type {
  ContractRecord,
  MailAccountRecord,
  MessageAiSummaryRecord,
  MessageRecord,
  MessageSecurityRecord,
  QuarantineRecord,
  User,
  UserAiCapabilityRecord,
} from "../types";

class Store {
  users: User[] = [];
  mailAccounts: MailAccountRecord[] = [];
  messages: MessageRecord[] = [];
  messageSecurity: Map<string, MessageSecurityRecord> = new Map(); // key: messageId
  quarantine: QuarantineRecord[] = [];
  contracts: ContractRecord[] = [];
  messageAiSummary: Map<string, MessageAiSummaryRecord> = new Map(); // key: messageId
  userAiCapability: Map<string, UserAiCapabilityRecord> = new Map(); // key: userId:platform

  // ----- Users / Accounts -----

  createUser(email: string): User {
    const user: User = { id: randomUUID(), email, createdAt: new Date().toISOString() };
    this.users.push(user);
    return user;
  }

  createMailAccount(input: Omit<MailAccountRecord, "id">): MailAccountRecord {
    const record: MailAccountRecord = { id: randomUUID(), ...input };
    this.mailAccounts.push(record);
    return record;
  }

  listMailAccounts(): MailAccountRecord[] {
    return this.mailAccounts;
  }

  getMailAccount(id: string): MailAccountRecord | undefined {
    return this.mailAccounts.find((a) => a.id === id);
  }

  // ----- Messages -----

  findMessageByHeader(mailAccountId: string, messageIdHeader: string): MessageRecord | undefined {
    return this.messages.find((m) => m.mailAccountId === mailAccountId && m.messageIdHeader === messageIdHeader);
  }

  insertMessage(input: Omit<MessageRecord, "id">): MessageRecord {
    const record: MessageRecord = { id: randomUUID(), ...input };
    this.messages.push(record);
    return record;
  }

  listMessages(filter: { folder?: string; accountId?: string }): MessageRecord[] {
    return this.messages
      .filter((m) => (filter.folder ? m.folder === filter.folder : true))
      .filter((m) => (filter.accountId ? m.mailAccountId === filter.accountId : true))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }

  getMessage(id: string): MessageRecord | undefined {
    return this.messages.find((m) => m.id === id);
  }

  updateMessageFolder(id: string, folder: MessageRecord["folder"]): void {
    const m = this.getMessage(id);
    if (m) m.folder = folder;
  }

  // ----- Security -----

  setMessageSecurity(record: MessageSecurityRecord): void {
    this.messageSecurity.set(record.messageId, record);
  }

  getMessageSecurity(messageId: string): MessageSecurityRecord | undefined {
    return this.messageSecurity.get(messageId);
  }

  // ----- Quarantäne -----

  quarantineMessage(messageId: string, reason: string): QuarantineRecord {
    const record: QuarantineRecord = {
      id: randomUUID(),
      messageId,
      quarantinedAt: new Date().toISOString(),
      reason,
      autoDeleteAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      userReviewed: false,
    };
    this.quarantine.push(record);
    this.updateMessageFolder(messageId, "quarantaene");
    return record;
  }

  // ----- Verträge -----

  insertContract(input: Omit<ContractRecord, "id">): ContractRecord {
    const record: ContractRecord = { id: randomUUID(), ...input };
    this.contracts.push(record);
    return record;
  }

  listContracts(): ContractRecord[] {
    return this.contracts;
  }

  getContract(id: string): ContractRecord | undefined {
    return this.contracts.find((c) => c.id === id);
  }

  // ----- KI-Zusammenfassung (Cache) -----

  setMessageAiSummary(record: MessageAiSummaryRecord): void {
    this.messageAiSummary.set(record.messageId, record);
  }

  getMessageAiSummary(messageId: string): MessageAiSummaryRecord | undefined {
    return this.messageAiSummary.get(messageId);
  }

  // ----- AI Capability -----

  setUserAiCapability(record: UserAiCapabilityRecord): void {
    this.userAiCapability.set(`${record.userId}:${record.platform}`, record);
  }
}

export const store = new Store();

/** Legt einen Demo-User + Demo-Konto an, falls noch keiner existiert. Wird
 * beim Serverstart aufgerufen, damit die API sofort ohne Setup nutzbar ist. */
export function ensureDemoUser(): { user: User; account: MailAccountRecord } {
  let user = store.users[0];
  if (!user) user = store.createUser("demo@driftmail.local");

  let account = store.mailAccounts.find((a) => a.userId === user.id);
  if (!account) {
    account = store.createMailAccount({
      userId: user.id,
      provider: "gmail",
      emailAddress: "demo@driftmail.local",
      encryptedOauthToken: null,
      encryptedImapCredentials: null,
      syncStatus: "pending",
      lastSyncedAt: null,
    });
  }
  return { user, account };
}
