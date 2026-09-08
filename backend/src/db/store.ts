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
  FolderRecord,
  MailAccountRecord,
  MessageAiSummaryRecord,
  MessageRecord,
  MessageSecurityRecord,
  OutgoingSendLogRecord,
  QuarantineRecord,
  SecurityAuditLogRecord,
  SystemFolderKey,
  User,
  UserAiCapabilityRecord,
} from "../types";

export class Store {
  users: User[] = [];
  mailAccounts: MailAccountRecord[] = [];
  folders: FolderRecord[] = [];
  messages: MessageRecord[] = [];
  messageSecurity: Map<string, MessageSecurityRecord> = new Map(); // key: messageId
  quarantine: QuarantineRecord[] = [];
  securityAuditLog: SecurityAuditLogRecord[] = [];
  // Dedupe-Fingerprint für den Auto-Delete-Pfad (adult/gambling-Spam, siehe
  // src/mail/sync.ts): da diese Mails NIE eine messages-Zeile bekommen, kann
  // findMessageByHeader() sie nicht wiedererkennen. Ohne diesen Set würde ein
  // erneuter Sync (z.B. wiederholtes POST /internal/sync) dieselbe Mail bei
  // jedem Lauf erneut "entdecken" und einen weiteren Audit-Log-Eintrag
  // schreiben. Hält nur `mailAccountId:messageIdHeader`, keinen Inhalt.
  autoDeletedHeaders: Set<string> = new Set();
  contracts: ContractRecord[] = [];
  messageAiSummary: Map<string, MessageAiSummaryRecord> = new Map(); // key: messageId
  userAiCapability: Map<string, UserAiCapabilityRecord> = new Map(); // key: userId:platform

  // ----- Externe Lookup-Adapter (SYNC.md 08.09., Web-Antwort "vier externe
  // Lookups") -----
  // IBAN-Historie je Absender+User (Grundlage für containsNewIban, siehe
  // src/lookups/ibanHistoryCheck.ts). Kein eigenes db-schema.sql-Pendant
  // (Auftrag: "simple Set/Map ... in deinem bestehenden Store") -- rein
  // In-Memory, geht bei Neustart verloren wie der Rest des Stores.
  ibanHistory: Map<string, Set<string>> = new Map(); // key: `${userId}:${senderAddress}`
  // `outgoing_send_log` (db-schema.sql, Commit a5432e6) -- Grundlage für den
  // Empfänger-Reputations-Lookup (siehe src/lookups/recipientReputationMock.ts).
  outgoingSendLog: OutgoingSendLogRecord[] = [];

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

  // ----- Ordner -----
  // CONTRACT-ÄNDERUNG (SYNC.md, Commit 734781e): benutzerdefinierte Ordner
  // statt festem Enum. Jeder User bekommt 5 System-Ordner (is_system=true,
  // system_key gesetzt, siehe ensureDemoUser) und kann beliebig eigene
  // Ordner (is_system=false, system_key=null) anlegen.

  createFolder(input: Omit<FolderRecord, "id">): FolderRecord {
    const record: FolderRecord = { id: randomUUID(), ...input };
    this.folders.push(record);
    return record;
  }

  listFolders(userId: string): FolderRecord[] {
    return this.folders.filter((f) => f.userId === userId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getFolder(id: string): FolderRecord | undefined {
    return this.folders.find((f) => f.id === id);
  }

  getSystemFolder(userId: string, systemKey: SystemFolderKey): FolderRecord | undefined {
    return this.folders.find((f) => f.userId === userId && f.systemKey === systemKey);
  }

  updateFolder(id: string, patch: Partial<Pick<FolderRecord, "name" | "icon" | "sortOrder">>): FolderRecord | undefined {
    const folder = this.getFolder(id);
    if (!folder) return undefined;
    if (patch.name !== undefined) folder.name = patch.name;
    if (patch.icon !== undefined) folder.icon = patch.icon;
    if (patch.sortOrder !== undefined) folder.sortOrder = patch.sortOrder;
    return folder;
  }

  deleteFolder(id: string): boolean {
    const idx = this.folders.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    this.folders.splice(idx, 1);
    return true;
  }

  // ----- Messages -----

  findMessageByHeader(mailAccountId: string, messageIdHeader: string): MessageRecord | undefined {
    return this.messages.find((m) => m.mailAccountId === mailAccountId && m.messageIdHeader === messageIdHeader);
  }

  /** Dedupe für den Auto-Delete-Pfad (siehe `autoDeletedHeaders`-Kommentar). */
  wasAutoDeleted(mailAccountId: string, messageIdHeader: string): boolean {
    return this.autoDeletedHeaders.has(`${mailAccountId}:${messageIdHeader}`);
  }

  markAutoDeleted(mailAccountId: string, messageIdHeader: string): void {
    this.autoDeletedHeaders.add(`${mailAccountId}:${messageIdHeader}`);
  }

  insertMessage(input: Omit<MessageRecord, "id">): MessageRecord {
    const record: MessageRecord = { id: randomUUID(), ...input };
    this.messages.push(record);
    return record;
  }

  listMessages(filter: { folderId?: string; accountId?: string }): MessageRecord[] {
    return this.messages
      .filter((m) => (filter.folderId ? m.folderId === filter.folderId : true))
      .filter((m) => (filter.accountId ? m.mailAccountId === filter.accountId : true))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }

  getMessage(id: string): MessageRecord | undefined {
    return this.messages.find((m) => m.id === id);
  }

  /** Verschiebt eine Nachricht in einen anderen Ordner (POST /messages/:id/move). */
  moveMessage(id: string, folderId: string): MessageRecord | undefined {
    const m = this.getMessage(id);
    if (m) m.folderId = folderId;
    return m;
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

    // Ordner-Umstellung (SYNC.md, Commit 734781e): der Quarantäne-"Ordner"
    // ist jetzt eine echte folders-Zeile pro User, kein fester String mehr.
    // Der User wird über die mail_account der Nachricht ermittelt (kein
    // eigenes userId-Feld auf messages, siehe db-schema.sql).
    const message = this.getMessage(messageId);
    const account = message ? this.getMailAccount(message.mailAccountId) : undefined;
    const quarantaeneFolder = account ? this.getSystemFolder(account.userId, "quarantaene") : undefined;
    if (quarantaeneFolder) this.moveMessage(messageId, quarantaeneFolder.id);

    return record;
  }

  // ----- Sicherheits-Audit-Log -----
  // `security_audit_log` (db-schema.sql). Write-only in diesem Durchstich --
  // kein GET-Endpunkt, weil `api-spec.yaml` dafür (noch) keinen vorsieht
  // (siehe README "Annahmen"). Aktuell einziger Schreiber: der
  // Auto-Delete-Pfad in src/mail/sync.ts (adult/gambling-Spam).
  logSecurityAudit(input: Omit<SecurityAuditLogRecord, "id" | "timestamp">): SecurityAuditLogRecord {
    const record: SecurityAuditLogRecord = { id: randomUUID(), timestamp: new Date().toISOString(), ...input };
    this.securityAuditLog.push(record);
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

  // ----- IBAN-Historie (Grundlage für containsNewIban) -----
  // "neu" heißt laut SYNC.md/Web-Antwort (08.09.): noch nie zuvor von diesem
  // Absender an diesen User gesehen -- deshalb Schlüssel userId+senderAddress,
  // nicht global.

  private ibanHistoryKey(userId: string, senderAddress: string): string {
    return `${userId}:${senderAddress.toLowerCase()}`;
  }

  hasSeenIban(userId: string, senderAddress: string, iban: string): boolean {
    return this.ibanHistory.get(this.ibanHistoryKey(userId, senderAddress))?.has(iban) ?? false;
  }

  recordIban(userId: string, senderAddress: string, iban: string): void {
    const key = this.ibanHistoryKey(userId, senderAddress);
    let seen = this.ibanHistory.get(key);
    if (!seen) {
      seen = new Set();
      this.ibanHistory.set(key, seen);
    }
    seen.add(iban);
  }

  // ----- Ausgehende Sends (Grundlage für recipientReputation) -----

  hasSentTo(userId: string, recipientAddress: string): boolean {
    const normalized = recipientAddress.toLowerCase();
    return this.outgoingSendLog.some((e) => e.userId === userId && e.recipientAddress.toLowerCase() === normalized);
  }

  recordOutgoingSend(input: { userId: string; recipientAddress: string; timeSinceDraftShownMs?: number | null }): OutgoingSendLogRecord {
    const wasNewRecipient = !this.hasSentTo(input.userId, input.recipientAddress);
    const record: OutgoingSendLogRecord = {
      id: randomUUID(),
      userId: input.userId,
      recipientAddress: input.recipientAddress,
      sentAt: new Date().toISOString(),
      timeSinceDraftShownMs: input.timeSinceDraftShownMs ?? null,
      wasNewRecipient,
    };
    this.outgoingSendLog.push(record);
    return record;
  }
}

export const store = new Store();

// Default-Namen/Icons/Reihenfolge der 5 System-Ordner — gespiegelt aus
// contracts/design-tokens.json ("systemFolders.defaults"). quarantaene und
// spam sind laut Contract nicht umbenennbar (siehe routes/folders.ts).
const SYSTEM_FOLDER_DEFAULTS: Array<{ systemKey: SystemFolderKey; name: string; icon: string }> = [
  { systemKey: "wichtig", name: "Wichtig", icon: "star" },
  { systemKey: "sonstiges", name: "Sonstiges", icon: "inbox" },
  { systemKey: "rechnungen", name: "Rechnungen", icon: "receipt" },
  { systemKey: "quarantaene", name: "Quarantäne", icon: "shield-exclamation" },
  { systemKey: "spam", name: "Spam", icon: "trash" },
];

/** Legt einen Demo-User + Demo-Konto + die 5 System-Ordner an, falls noch
 * keine existieren. Wird beim Serverstart aufgerufen, damit die API sofort
 * ohne Setup nutzbar ist. */
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

  if (store.listFolders(user.id).length === 0) {
    SYSTEM_FOLDER_DEFAULTS.forEach((def, index) => {
      store.createFolder({
        userId: user.id,
        name: def.name,
        icon: def.icon,
        isSystem: true,
        systemKey: def.systemKey,
        sortOrder: index,
      });
    });
  }

  // Demo-Seed für den Empfänger-Reputations-Lookup (src/lookups/
  // recipientReputationMock.ts): der Demo-User hat "kollegin@example.com"
  // (Fixture 4, harmlose Kollegin-Mail) bereits einmal erfolgreich
  // angeschrieben -- macht den "safe"-Fall im Mock ohne echten Versand-Pfad
  // testbar. Reiner Beispieldaten-Seed, KEINE echte Versandhistorie.
  if (!store.hasSentTo(user.id, "kollegin@example.com")) {
    store.recordOutgoingSend({ userId: user.id, recipientAddress: "kollegin@example.com" });
  }

  return { user, account };
}
