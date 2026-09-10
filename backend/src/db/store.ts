// Datenhaltung für das Backend.
//
// Echte Persistenz (Terminal 09.09., Web-Priorisierung "Persistenz zuerst"
// -- siehe TERMINAL_INBOX.md/SYNC.md): `store` zeigt auf eine
// Postgres-Anbindung (`PostgresStore`, siehe postgresStore.ts), wenn
// `DATABASE_URL` gesetzt ist, sonst auf die ursprüngliche `InMemoryStore`
// (Daten gehen bei Neustart verloren, aber kein DB-Setup nötig -- gleiches
// Muster wie bei Gmail/IMAP vs. Fixture-Adapter: echt, wenn ENV gesetzt
// ist, sonst Zero-Config-Fallback). Beide implementieren dasselbe `Store`-
// Interface, exakt mit den Feldern/Typen aus contracts/db-schema.sql --
// Routen und Sync-Pipeline arbeiten nur gegen dieses Interface, nicht
// gegen eine der beiden konkreten Implementierungen.
//
// Alle Methoden sind async (auch bei InMemoryStore, wo das nicht nötig
// wäre) -- eine echte DB-Anbindung kann nicht synchron sein, und die
// Caller sollen nicht wissen müssen, welche Implementierung gerade läuft.

import { randomUUID } from "node:crypto";
import { PostgresStore } from "./postgresStore";
import type {
  ContractRecord,
  DraftRecord,
  FolderRecord,
  MailAccountRecord,
  MessageAiSummaryRecord,
  MessageAttachmentRecord,
  MessageRecord,
  MessageSecurityRecord,
  OutgoingSendLogRecord,
  QuarantineRecord,
  SecurityAuditLogRecord,
  SystemFolderKey,
  UnsubscribeActionRecord,
  User,
  UserAiCapabilityRecord,
} from "../types";

export interface Store {
  // ----- Users / Accounts -----
  createUser(email: string): Promise<User>;
  /** Für ensureDemoUser(): liefert den ersten angelegten User, falls vorhanden. */
  getFirstUser(): Promise<User | undefined>;
  createMailAccount(input: Omit<MailAccountRecord, "id">): Promise<MailAccountRecord>;
  listMailAccounts(): Promise<MailAccountRecord[]>;
  getMailAccount(id: string): Promise<MailAccountRecord | undefined>;
  getMailAccountByUserId(userId: string): Promise<MailAccountRecord | undefined>;
  /** Für den Sync-Status (syncAccount() in mail/sync.ts) -- ersetzt die
   * vorherige direkte Mutation des `MailAccountRecord`-Objekts, die bei
   * einer echten DB nicht persistiert hätte. */
  updateMailAccount(id: string, patch: Partial<Pick<MailAccountRecord, "syncStatus" | "lastSyncedAt">>): Promise<MailAccountRecord | undefined>;

  // ----- Ordner -----
  createFolder(input: Omit<FolderRecord, "id">): Promise<FolderRecord>;
  listFolders(userId: string): Promise<FolderRecord[]>;
  getFolder(id: string): Promise<FolderRecord | undefined>;
  getSystemFolder(userId: string, systemKey: SystemFolderKey): Promise<FolderRecord | undefined>;
  updateFolder(id: string, patch: Partial<Pick<FolderRecord, "name" | "icon" | "sortOrder">>): Promise<FolderRecord | undefined>;
  deleteFolder(id: string): Promise<boolean>;

  // ----- Messages -----
  findMessageByHeader(mailAccountId: string, messageIdHeader: string): Promise<MessageRecord | undefined>;
  wasAutoDeleted(mailAccountId: string, messageIdHeader: string): Promise<boolean>;
  markAutoDeleted(mailAccountId: string, messageIdHeader: string): Promise<void>;
  insertMessage(input: Omit<MessageRecord, "id">): Promise<MessageRecord>;
  listMessages(filter: { folderId?: string; accountId?: string }): Promise<MessageRecord[]>;
  getMessage(id: string): Promise<MessageRecord | undefined>;
  moveMessage(id: string, folderId: string): Promise<MessageRecord | undefined>;
  deleteMessage(id: string): Promise<boolean>;

  // ----- Security -----
  setMessageSecurity(record: MessageSecurityRecord): Promise<void>;
  getMessageSecurity(messageId: string): Promise<MessageSecurityRecord | undefined>;
  /** Empfänger-Reputations-Lookup (siehe lookups/recipientReputationMock.ts):
   * true, wenn eine eingehende, als "phishing" klassifizierte Nachricht von
   * dieser Adresse ODER Domain existiert. Eigene Methode statt Rohzugriff
   * auf `messages`, weil das mit einer echten DB ein einzelnes SQL-Join
   * wird statt eines In-Memory-Scans. */
  hasPhishingMessageFrom(address: string, domain: string | null): Promise<boolean>;

  // ----- Quarantäne -----
  quarantineMessage(messageId: string, reason: string): Promise<QuarantineRecord>;
  getQuarantineForMessage(messageId: string): Promise<QuarantineRecord | undefined>;

  // ----- Sicherheits-Audit-Log -----
  logSecurityAudit(input: Omit<SecurityAuditLogRecord, "id" | "timestamp">): Promise<SecurityAuditLogRecord>;
  listSecurityAuditLog(filter: { userId?: string; action?: string }): Promise<SecurityAuditLogRecord[]>;

  // ----- Verträge -----
  insertContract(input: Omit<ContractRecord, "id">): Promise<ContractRecord>;
  listContracts(): Promise<ContractRecord[]>;
  getContract(id: string): Promise<ContractRecord | undefined>;
  updateContract(id: string, patch: Partial<Omit<ContractRecord, "id">>): Promise<ContractRecord | undefined>;

  // ----- KI-Zusammenfassung (Cache) -----
  setMessageAiSummary(record: MessageAiSummaryRecord): Promise<void>;
  getMessageAiSummary(messageId: string): Promise<MessageAiSummaryRecord | undefined>;

  // ----- AI Capability -----
  setUserAiCapability(record: UserAiCapabilityRecord): Promise<void>;

  // ----- IBAN-Historie (Grundlage für containsNewIban) -----
  hasSeenIban(userId: string, senderAddress: string, iban: string): Promise<boolean>;
  recordIban(userId: string, senderAddress: string, iban: string): Promise<void>;

  // ----- Ausgehende Sends (Grundlage für recipientReputation) -----
  hasSentTo(userId: string, recipientAddress: string): Promise<boolean>;
  recordOutgoingSend(input: { userId: string; recipientAddress: string; timeSinceDraftShownMs?: number | null }): Promise<OutgoingSendLogRecord>;

  // ----- Anhänge (POST /attachments + POST /messages/send, WEB_INBOX.md
  // 09.09. "Erweiterung des Send-Endpunkt-Eintrags von eben") -----
  insertAttachment(input: Omit<MessageAttachmentRecord, "id">): Promise<MessageAttachmentRecord>;
  getAttachment(id: string): Promise<MessageAttachmentRecord | undefined>;
  /** Trägt nach erfolgreichem Versand die neu entstandene messageId auf die
   * (vorher nur per uploadedByUserId zugeordneten) Anhänge nach. */
  linkAttachmentsToMessage(ids: string[], messageId: string): Promise<void>;

  // ----- Entwürfe (POST/GET /drafts, PATCH/DELETE /drafts/{id}, WEB_INBOX.md
  // 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags") -----
  createDraft(input: Omit<DraftRecord, "id" | "updatedAt">): Promise<DraftRecord>;
  listDrafts(userId: string): Promise<DraftRecord[]>;
  getDraft(id: string): Promise<DraftRecord | undefined>;
  updateDraft(
    id: string,
    patch: Partial<Pick<DraftRecord, "toAddresses" | "ccAddresses" | "subject" | "bodyText">>,
  ): Promise<DraftRecord | undefined>;
  deleteDraft(id: string): Promise<boolean>;

  // ----- Unsubscribe (POST /messages/{id}/unsubscribe + automatische
  // Abmeldung bei Spam, WEB_INBOX.md 09.09. "Automatisches Abmelden bei
  // Spam") -----
  insertUnsubscribeAction(input: Omit<UnsubscribeActionRecord, "id" | "triggeredAt">): Promise<UnsubscribeActionRecord>;
  /** `messageId: null` filtert gezielt auf Einträge OHNE Nachricht (adult/
   * gambling-Auto-Delete-Pfad, siehe UnsubscribeActionRecord-Kommentar);
   * `messageId` weggelassen filtert gar nicht danach. Nur für den
   * Smoketest gedacht (kein API-Endpunkt liest diese Liste). */
  listUnsubscribeActions(filter: { userId?: string; messageId?: string | null }): Promise<UnsubscribeActionRecord[]>;
}

/** In-Memory-Implementierung (Standard, wenn DATABASE_URL nicht gesetzt ist).
 * Daten gehen bei jedem Neustart verloren -- siehe Kopfkommentar. */
export class InMemoryStore implements Store {
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
  // `drafts` (db-schema.sql) -- siehe DraftRecord-Kommentar in types.ts.
  drafts: DraftRecord[] = [];
  // `unsubscribe_actions` (db-schema.sql) -- siehe UnsubscribeActionRecord-
  // Kommentar in types.ts.
  unsubscribeActions: UnsubscribeActionRecord[] = [];

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
  // `message_attachments` (db-schema.sql) -- siehe MessageAttachmentRecord-
  // Kommentar in types.ts.
  messageAttachments: MessageAttachmentRecord[] = [];

  // ----- Users / Accounts -----

  async createUser(email: string): Promise<User> {
    const user: User = { id: randomUUID(), email, createdAt: new Date().toISOString() };
    this.users.push(user);
    return user;
  }

  async getFirstUser(): Promise<User | undefined> {
    return this.users[0];
  }

  async createMailAccount(input: Omit<MailAccountRecord, "id">): Promise<MailAccountRecord> {
    const record: MailAccountRecord = { id: randomUUID(), ...input };
    this.mailAccounts.push(record);
    return record;
  }

  async listMailAccounts(): Promise<MailAccountRecord[]> {
    return this.mailAccounts;
  }

  async getMailAccount(id: string): Promise<MailAccountRecord | undefined> {
    return this.mailAccounts.find((a) => a.id === id);
  }

  async getMailAccountByUserId(userId: string): Promise<MailAccountRecord | undefined> {
    return this.mailAccounts.find((a) => a.userId === userId);
  }

  async updateMailAccount(
    id: string,
    patch: Partial<Pick<MailAccountRecord, "syncStatus" | "lastSyncedAt">>,
  ): Promise<MailAccountRecord | undefined> {
    const account = await this.getMailAccount(id);
    if (!account) return undefined;
    if (patch.syncStatus !== undefined) account.syncStatus = patch.syncStatus;
    if (patch.lastSyncedAt !== undefined) account.lastSyncedAt = patch.lastSyncedAt;
    return account;
  }

  // ----- Ordner -----
  // CONTRACT-ÄNDERUNG (SYNC.md, Commit 734781e): benutzerdefinierte Ordner
  // statt festem Enum. Jeder User bekommt 5 System-Ordner (is_system=true,
  // system_key gesetzt, siehe ensureDemoUser) und kann beliebig eigene
  // Ordner (is_system=false, system_key=null) anlegen.

  async createFolder(input: Omit<FolderRecord, "id">): Promise<FolderRecord> {
    const record: FolderRecord = { id: randomUUID(), ...input };
    this.folders.push(record);
    return record;
  }

  async listFolders(userId: string): Promise<FolderRecord[]> {
    return this.folders.filter((f) => f.userId === userId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getFolder(id: string): Promise<FolderRecord | undefined> {
    return this.folders.find((f) => f.id === id);
  }

  async getSystemFolder(userId: string, systemKey: SystemFolderKey): Promise<FolderRecord | undefined> {
    return this.folders.find((f) => f.userId === userId && f.systemKey === systemKey);
  }

  async updateFolder(
    id: string,
    patch: Partial<Pick<FolderRecord, "name" | "icon" | "sortOrder">>,
  ): Promise<FolderRecord | undefined> {
    const folder = await this.getFolder(id);
    if (!folder) return undefined;
    if (patch.name !== undefined) folder.name = patch.name;
    if (patch.icon !== undefined) folder.icon = patch.icon;
    if (patch.sortOrder !== undefined) folder.sortOrder = patch.sortOrder;
    return folder;
  }

  async deleteFolder(id: string): Promise<boolean> {
    const idx = this.folders.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    this.folders.splice(idx, 1);
    return true;
  }

  // ----- Messages -----

  async findMessageByHeader(mailAccountId: string, messageIdHeader: string): Promise<MessageRecord | undefined> {
    return this.messages.find((m) => m.mailAccountId === mailAccountId && m.messageIdHeader === messageIdHeader);
  }

  /** Dedupe für den Auto-Delete-Pfad (siehe `autoDeletedHeaders`-Kommentar). */
  async wasAutoDeleted(mailAccountId: string, messageIdHeader: string): Promise<boolean> {
    return this.autoDeletedHeaders.has(`${mailAccountId}:${messageIdHeader}`);
  }

  async markAutoDeleted(mailAccountId: string, messageIdHeader: string): Promise<void> {
    this.autoDeletedHeaders.add(`${mailAccountId}:${messageIdHeader}`);
  }

  async insertMessage(input: Omit<MessageRecord, "id">): Promise<MessageRecord> {
    const record: MessageRecord = { id: randomUUID(), ...input };
    this.messages.push(record);
    return record;
  }

  async listMessages(filter: { folderId?: string; accountId?: string }): Promise<MessageRecord[]> {
    return this.messages
      .filter((m) => (filter.folderId ? m.folderId === filter.folderId : true))
      .filter((m) => (filter.accountId ? m.mailAccountId === filter.accountId : true))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }

  async getMessage(id: string): Promise<MessageRecord | undefined> {
    return this.messages.find((m) => m.id === id);
  }

  /** Verschiebt eine Nachricht in einen anderen Ordner (POST /messages/:id/move). */
  async moveMessage(id: string, folderId: string): Promise<MessageRecord | undefined> {
    const m = await this.getMessage(id);
    if (m) m.folderId = folderId;
    return m;
  }

  /** Entfernt eine Nachricht endgültig aus dem Store (DELETE /messages/:id/permanent). */
  async deleteMessage(id: string): Promise<boolean> {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.messages.splice(idx, 1);
    this.messageSecurity.delete(id);
    this.messageAiSummary.delete(id);
    return true;
  }

  // ----- Security -----

  async setMessageSecurity(record: MessageSecurityRecord): Promise<void> {
    this.messageSecurity.set(record.messageId, record);
  }

  async getMessageSecurity(messageId: string): Promise<MessageSecurityRecord | undefined> {
    return this.messageSecurity.get(messageId);
  }

  async hasPhishingMessageFrom(address: string, domain: string | null): Promise<boolean> {
    const normalized = address.toLowerCase();
    return this.messages.some((m) => {
      const fromLower = m.fromAddress.toLowerCase();
      const sameAddress = fromLower === normalized;
      const sameDomain = domain !== null && fromLower.split("@")[1] === domain;
      if (!sameAddress && !sameDomain) return false;
      const security = this.messageSecurity.get(m.id);
      return security?.classification === "phishing";
    });
  }

  // ----- Quarantäne -----

  async quarantineMessage(messageId: string, reason: string): Promise<QuarantineRecord> {
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
    const message = await this.getMessage(messageId);
    const account = message ? await this.getMailAccount(message.mailAccountId) : undefined;
    const quarantaeneFolder = account ? await this.getSystemFolder(account.userId, "quarantaene") : undefined;
    if (quarantaeneFolder) await this.moveMessage(messageId, quarantaeneFolder.id);

    return record;
  }

  // WEB_INBOX.md 08.09. (Track F) + contracts/api-spec.yaml `QuarantineInfo`
  // (Terminal 09.09.): `reason`/`autoDeleteAt` waren in der `quarantine`-
  // Tabelle zwar vorhanden, aber ohne Lese-Weg für die API. Letzter Eintrag
  // gewinnt, falls eine Nachricht (aktuell nicht möglich, aber nicht
  // ausgeschlossen) mehrfach in Quarantäne landet.
  async getQuarantineForMessage(messageId: string): Promise<QuarantineRecord | undefined> {
    return [...this.quarantine].reverse().find((q) => q.messageId === messageId);
  }

  // ----- Sicherheits-Audit-Log -----
  // `security_audit_log` (db-schema.sql). Write-only im Contract-Sinn --
  // kein GET-Endpunkt, weil `api-spec.yaml` dafür (noch) keinen vorsieht
  // (siehe README "Annahmen"). `listSecurityAuditLog()` selbst ist nur für
  // den Smoketest da (direkter Store-Zugriff, kein API-Pfad).
  async logSecurityAudit(input: Omit<SecurityAuditLogRecord, "id" | "timestamp">): Promise<SecurityAuditLogRecord> {
    const record: SecurityAuditLogRecord = { id: randomUUID(), timestamp: new Date().toISOString(), ...input };
    this.securityAuditLog.push(record);
    return record;
  }

  async listSecurityAuditLog(filter: { userId?: string; action?: string }): Promise<SecurityAuditLogRecord[]> {
    return this.securityAuditLog
      .filter((e) => (filter.userId ? e.userId === filter.userId : true))
      .filter((e) => (filter.action ? e.action === filter.action : true));
  }

  // ----- Verträge -----

  async insertContract(input: Omit<ContractRecord, "id">): Promise<ContractRecord> {
    const record: ContractRecord = { id: randomUUID(), ...input };
    this.contracts.push(record);
    return record;
  }

  async listContracts(): Promise<ContractRecord[]> {
    return this.contracts;
  }

  async getContract(id: string): Promise<ContractRecord | undefined> {
    return this.contracts.find((c) => c.id === id);
  }

  async updateContract(id: string, patch: Partial<Omit<ContractRecord, "id">>): Promise<ContractRecord | undefined> {
    const contract = await this.getContract(id);
    if (!contract) return undefined;
    Object.assign(contract, patch);
    return contract;
  }

  // ----- KI-Zusammenfassung (Cache) -----

  async setMessageAiSummary(record: MessageAiSummaryRecord): Promise<void> {
    this.messageAiSummary.set(record.messageId, record);
  }

  async getMessageAiSummary(messageId: string): Promise<MessageAiSummaryRecord | undefined> {
    return this.messageAiSummary.get(messageId);
  }

  // ----- AI Capability -----

  async setUserAiCapability(record: UserAiCapabilityRecord): Promise<void> {
    this.userAiCapability.set(`${record.userId}:${record.platform}`, record);
  }

  // ----- IBAN-Historie (Grundlage für containsNewIban) -----
  // "neu" heißt laut SYNC.md/Web-Antwort (08.09.): noch nie zuvor von diesem
  // Absender an diesen User gesehen -- deshalb Schlüssel userId+senderAddress,
  // nicht global.

  private ibanHistoryKey(userId: string, senderAddress: string): string {
    return `${userId}:${senderAddress.toLowerCase()}`;
  }

  async hasSeenIban(userId: string, senderAddress: string, iban: string): Promise<boolean> {
    return this.ibanHistory.get(this.ibanHistoryKey(userId, senderAddress))?.has(iban) ?? false;
  }

  async recordIban(userId: string, senderAddress: string, iban: string): Promise<void> {
    const key = this.ibanHistoryKey(userId, senderAddress);
    let seen = this.ibanHistory.get(key);
    if (!seen) {
      seen = new Set();
      this.ibanHistory.set(key, seen);
    }
    seen.add(iban);
  }

  // ----- Ausgehende Sends (Grundlage für recipientReputation) -----

  async hasSentTo(userId: string, recipientAddress: string): Promise<boolean> {
    const normalized = recipientAddress.toLowerCase();
    return this.outgoingSendLog.some((e) => e.userId === userId && e.recipientAddress.toLowerCase() === normalized);
  }

  async recordOutgoingSend(input: {
    userId: string;
    recipientAddress: string;
    timeSinceDraftShownMs?: number | null;
  }): Promise<OutgoingSendLogRecord> {
    const wasNewRecipient = !(await this.hasSentTo(input.userId, input.recipientAddress));
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

  // ----- Anhänge -----

  async insertAttachment(input: Omit<MessageAttachmentRecord, "id">): Promise<MessageAttachmentRecord> {
    const record: MessageAttachmentRecord = { id: randomUUID(), ...input };
    this.messageAttachments.push(record);
    return record;
  }

  async getAttachment(id: string): Promise<MessageAttachmentRecord | undefined> {
    return this.messageAttachments.find((a) => a.id === id);
  }

  async linkAttachmentsToMessage(ids: string[], messageId: string): Promise<void> {
    for (const attachment of this.messageAttachments) {
      if (ids.includes(attachment.id)) attachment.messageId = messageId;
    }
  }

  // ----- Entwürfe -----

  async createDraft(input: Omit<DraftRecord, "id" | "updatedAt">): Promise<DraftRecord> {
    const record: DraftRecord = { id: randomUUID(), updatedAt: new Date().toISOString(), ...input };
    this.drafts.push(record);
    return record;
  }

  async listDrafts(userId: string): Promise<DraftRecord[]> {
    return this.drafts.filter((d) => d.userId === userId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async getDraft(id: string): Promise<DraftRecord | undefined> {
    return this.drafts.find((d) => d.id === id);
  }

  async updateDraft(
    id: string,
    patch: Partial<Pick<DraftRecord, "toAddresses" | "ccAddresses" | "subject" | "bodyText">>,
  ): Promise<DraftRecord | undefined> {
    const draft = await this.getDraft(id);
    if (!draft) return undefined;
    if (patch.toAddresses !== undefined) draft.toAddresses = patch.toAddresses;
    if (patch.ccAddresses !== undefined) draft.ccAddresses = patch.ccAddresses;
    if (patch.subject !== undefined) draft.subject = patch.subject;
    if (patch.bodyText !== undefined) draft.bodyText = patch.bodyText;
    draft.updatedAt = new Date().toISOString();
    return draft;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const idx = this.drafts.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this.drafts.splice(idx, 1);
    return true;
  }

  // ----- Unsubscribe -----

  async insertUnsubscribeAction(input: Omit<UnsubscribeActionRecord, "id" | "triggeredAt">): Promise<UnsubscribeActionRecord> {
    const record: UnsubscribeActionRecord = { id: randomUUID(), triggeredAt: new Date().toISOString(), ...input };
    this.unsubscribeActions.push(record);
    return record;
  }

  async listUnsubscribeActions(filter: { userId?: string; messageId?: string | null }): Promise<UnsubscribeActionRecord[]> {
    return this.unsubscribeActions
      .filter((a) => (filter.userId ? a.userId === filter.userId : true))
      .filter((a) => (filter.messageId === undefined ? true : a.messageId === filter.messageId));
  }
}

// `pg.Pool` baut beim Konstruieren keine Verbindung auf (lazy connect bei
// der ersten Query) -- der Import von PostgresStore ist deshalb immer
// sicher, auch ohne laufenden Postgres-Server. Nur INSTANZIIERT wird sie
// aber nur, wenn DATABASE_URL gesetzt ist -- exakt dasselbe
// "echt, wenn ENV gesetzt ist, sonst Zero-Config-Fallback"-Muster wie beim
// Gmail-/IMAP-Adapter (siehe mail/sync.ts adapterForAccount()).
function createStore(): Store {
  const databaseUrl = process.env.DATABASE_URL;
  return databaseUrl ? new PostgresStore(databaseUrl) : new InMemoryStore();
}

export const store: Store = createStore();

/** Führt beim Start einmalig nötige Initialisierung aus (Schema-Migration
 * für Postgres, No-Op für InMemoryStore). Muss vor dem ersten Store-Zugriff
 * abgewartet werden (siehe index.ts/smoketest.ts). */
export async function initStore(): Promise<void> {
  if (store instanceof PostgresStore) await store.migrate();
}

// Default-Namen/Icons/Reihenfolge der System-Ordner — gespiegelt aus
// contracts/design-tokens.json ("systemFolders.defaults"). quarantaene, spam,
// papierkorb, entwuerfe und gesendet sind laut Contract nicht umbenennbar
// (siehe routes/folders.ts). [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09.
// "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"): wichtig/rechnungen
// entfallen, eingang/entwuerfe/gesendet sind neu — jetzt 7 statt 6
// System-Ordner. Reihenfolge hier = Sidebar-Reihenfolge (Vorschlag laut Auftrag).
const SYSTEM_FOLDER_DEFAULTS: Array<{ systemKey: SystemFolderKey; name: string; icon: string }> = [
  { systemKey: "eingang", name: "Eingang", icon: "inbox" },
  { systemKey: "entwuerfe", name: "Entwürfe", icon: "file-pencil" },
  { systemKey: "gesendet", name: "Gesendet", icon: "send" },
  { systemKey: "sonstiges", name: "Sonstiges", icon: "folder" },
  { systemKey: "quarantaene", name: "Quarantäne", icon: "shield-exclamation" },
  { systemKey: "spam", name: "Spam", icon: "trash" },
  { systemKey: "papierkorb", name: "Papierkorb", icon: "trash-2" },
];

// Alte System-Ordner (vor dem Ordner-Umbau), die als System-Ordner entfallen
// -- Nachrichten darin wandern nach "eingang", die Ordner-Zeilen selbst
// werden entfernt (gleiches Prinzip wie beim Löschen eines eigenen Ordners,
// siehe deleteFolder()-Aufrufer in routes/folders.ts).
// `as string[]` statt `SystemFolderKey[]`: diese beiden Werte sind laut
// aktuellem Contract gar keine gueltigen SystemFolderKey-Werte mehr -- das
// ist hier bewusst so, weil zur Laufzeit echte Bestandsdaten von VOR dem
// Ordner-Umbau genau diese (inzwischen ungueltigen) Strings enthalten
// koennen. Der Vergleich unten arbeitet deshalb auf String-Ebene.
const LEGACY_SYSTEM_FOLDER_KEYS: string[] = ["wichtig", "rechnungen"];

/** Migriert einen User von der alten 6-Ordner- auf die neue 7-Ordner-Struktur
 * (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags").
 * Idempotent -- für neu angelegte User (die die neuen Defaults schon über
 * `ensureDemoUser()` bekommen haben) sind beide Schritte No-Ops. Kein
 * SQL-Migrationstool (siehe db-schema.sql-Kommentar), stattdessen
 * Anwendungslogik wie beim Löschen eines Ordners. */
async function migrateLegacySystemFolders(userId: string): Promise<void> {
  const folders = await store.listFolders(userId);
  const bySystemKey = new Map(folders.filter((f) => f.systemKey).map((f) => [f.systemKey as SystemFolderKey, f]));

  // Schritt 1: neue Pflicht-System-Ordner nachrüsten, falls sie fehlen (User
  // von vor dem Umbau hatte nur die alten 6).
  for (const [index, def] of SYSTEM_FOLDER_DEFAULTS.entries()) {
    if (bySystemKey.has(def.systemKey)) continue;
    const created = await store.createFolder({
      userId,
      name: def.name,
      icon: def.icon,
      isSystem: true,
      systemKey: def.systemKey,
      sortOrder: index,
    });
    bySystemKey.set(def.systemKey, created);
  }

  // Schritt 2: wichtig/rechnungen (falls vorhanden) -- Nachrichten nach
  // "eingang" verschieben, Ordner-Zeile entfernen.
  const eingang = bySystemKey.get("eingang");
  if (!eingang) return; // sollte nach Schritt 1 nie passieren
  for (const legacyKey of LEGACY_SYSTEM_FOLDER_KEYS) {
    const legacy = folders.find((f) => f.systemKey === legacyKey);
    if (!legacy) continue;
    const messages = await store.listMessages({ folderId: legacy.id });
    for (const m of messages) await store.moveMessage(m.id, eingang.id);
    await store.deleteFolder(legacy.id);
  }
}

/** Legt einen Demo-User + Demo-Konto + die System-Ordner an, falls noch
 * keine existieren. Wird beim Serverstart aufgerufen, damit die API sofort
 * ohne Setup nutzbar ist. */
export async function ensureDemoUser(): Promise<{ user: User; account: MailAccountRecord }> {
  let user = await store.getFirstUser();
  if (!user) user = await store.createUser("demo@driftmail.local");

  let account = await store.getMailAccountByUserId(user.id);
  if (!account) {
    account = await store.createMailAccount({
      userId: user.id,
      provider: "gmail",
      emailAddress: "demo@driftmail.local",
      encryptedOauthToken: null,
      encryptedImapCredentials: null,
      syncStatus: "pending",
      lastSyncedAt: null,
    });
  }

  if ((await store.listFolders(user.id)).length === 0) {
    for (const [index, def] of SYSTEM_FOLDER_DEFAULTS.entries()) {
      await store.createFolder({
        userId: user.id,
        name: def.name,
        icon: def.icon,
        isSystem: true,
        systemKey: def.systemKey,
        sortOrder: index,
      });
    }
  } else {
    // Bestehender User (von vor dem Ordner-Umbau) -- neue Pflicht-Ordner
    // nachrüsten + wichtig/rechnungen auflösen. Im `length === 0`-Zweig
    // oben nicht nötig, da SYSTEM_FOLDER_DEFAULTS für neue User bereits die
    // neue Liste ist.
    await migrateLegacySystemFolders(user.id);
  }

  // Demo-Seed für den Empfänger-Reputations-Lookup (src/lookups/
  // recipientReputationMock.ts): der Demo-User hat "kollegin@example.com"
  // (Fixture 4, harmlose Kollegin-Mail) bereits einmal erfolgreich
  // angeschrieben -- macht den "safe"-Fall im Mock ohne echten Versand-Pfad
  // testbar. Reiner Beispieldaten-Seed, KEINE echte Versandhistorie.
  if (!(await store.hasSentTo(user.id, "kollegin@example.com"))) {
    await store.recordOutgoingSend({ userId: user.id, recipientAddress: "kollegin@example.com" });
  }

  return { user, account };
}
