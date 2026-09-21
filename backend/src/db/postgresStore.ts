// Echte Postgres-Anbindung für das `Store`-Interface (store.ts). Wird nur
// instanziiert, wenn `DATABASE_URL` gesetzt ist -- siehe store.ts
// `createStore()`. Implementiert exakt dasselbe Interface wie
// `InMemoryStore`, damit Routen/Sync-Pipeline unverändert bleiben.
//
// Typ-Konvertierung (siehe `configureTypeParsers` unten): `pg` liefert
// TIMESTAMPTZ standardmäßig als JS-`Date` und NUMERIC als String, um
// Präzisionsverlust zu vermeiden -- beides passt nicht zu den `string`-
// bzw. `number`-Typen in `../types.ts` (1:1 aus contracts/db-schema.sql
// gespiegelt). Deshalb global umkonfiguriert: TIMESTAMPTZ -> ISO-8601-
// String (`new Date(...).toISOString()`, identisch zum Format, das
// `InMemoryStore` überall verwendet), DATE -> unverändertes `YYYY-MM-DD`
// (Postgres' Text-Ausgabe für `date` ist ohnehin schon exakt dieses
// Format -- kein Date-Objekt-Umweg nötig, der bei Zeitzonen Fallstricke
// hätte), NUMERIC -> `parseFloat`. Das passiert einmalig beim Modul-Import
// (pg.types ist ein globales, prozessweites Registry) und gilt für JEDE
// Query über dieses `pg`-Modul in diesem Prozess -- unkritisch, da dieser
// Backend-Prozess der einzige `pg`-Nutzer ist.

import { Pool, types } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store";
import type {
  AiPreferenceRecord,
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
  SessionRecord,
  SystemFolderKey,
  TrustedSenderRecord,
  UnsubscribeActionRecord,
  User,
  UserAiCapabilityRecord,
} from "../types";

// Gleicher Wert wie store.ts `SESSION_TTL_MS` -- bewusst hier dupliziert
// statt importiert, um keinen zirkulären Modul-Import store.ts <-> hier
// einzuführen (store.ts importiert bereits `PostgresStore` von hier).
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const TYPE_OID_DATE = 1082;
const TYPE_OID_TIMESTAMP = 1114;
const TYPE_OID_TIMESTAMPTZ = 1184;
const TYPE_OID_NUMERIC = 1700;

let typeParsersConfigured = false;
function configureTypeParsers(): void {
  if (typeParsersConfigured) return;
  typeParsersConfigured = true;
  types.setTypeParser(TYPE_OID_DATE, (val) => val); // 'YYYY-MM-DD' bereits exakt im richtigen Format
  types.setTypeParser(TYPE_OID_TIMESTAMP, (val) => new Date(val).toISOString());
  types.setTypeParser(TYPE_OID_TIMESTAMPTZ, (val) => new Date(val).toISOString());
  types.setTypeParser(TYPE_OID_NUMERIC, (val) => (val === null ? null : parseFloat(val)));
}

// contracts/db-schema.sql liegt relativ zu diesem Modul unter ../../../ --
// gilt gleichermaßen für src/db/ (tsx/dev) und dist/db/ (nach `npm run
// build`), da beide gleich tief unter backend/ liegen.
const SCHEMA_PATH = join(__dirname, "../../../contracts/db-schema.sql");

function rowToUser(r: any): User {
  return { id: r.id, email: r.email, createdAt: r.created_at };
}

function rowToSession(r: any): SessionRecord {
  return { id: r.id, userId: r.user_id, token: r.token, createdAt: r.created_at, expiresAt: r.expires_at };
}

function rowToMailAccount(r: any): MailAccountRecord {
  return {
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    emailAddress: r.email_address,
    encryptedOauthToken: r.encrypted_oauth_token,
    encryptedImapCredentials: r.encrypted_imap_credentials,
    syncStatus: r.sync_status,
    lastSyncedAt: r.last_synced_at,
  };
}

function rowToTrustedSender(r: any): TrustedSenderRecord {
  return { id: r.id, userId: r.user_id, senderAddress: r.sender_address, addedAt: r.added_at };
}

function rowToFolder(r: any): FolderRecord {
  return {
    id: r.id,
    mailAccountId: r.mail_account_id,
    name: r.name,
    icon: r.icon,
    isSystem: r.is_system,
    systemKey: r.system_key,
    sortOrder: r.sort_order,
  };
}

function rowToMessage(r: any): MessageRecord {
  return {
    id: r.id,
    mailAccountId: r.mail_account_id,
    messageIdHeader: r.message_id_header,
    providerMessageId: r.provider_message_id,
    fromAddress: r.from_address,
    fromDisplayName: r.from_display_name,
    replyToAddress: r.reply_to_address,
    subject: r.subject,
    bodyText: r.body_text,
    receivedAt: r.received_at,
    folderId: r.folder_id,
    rawHeaders: r.raw_headers,
    inReplyToMessageId: r.in_reply_to_message_id,
  };
}

function rowToMessageSecurity(r: any): MessageSecurityRecord {
  return {
    messageId: r.message_id,
    spfStatus: r.spf_status,
    dkimStatus: r.dkim_status,
    dmarcStatus: r.dmarc_status,
    senderDomainAgeDays: r.sender_domain_age_days,
    domainReputationScore: r.domain_reputation_score,
    homoglyphDetected: r.homoglyph_detected,
    linkMismatchDetected: r.link_mismatch_detected,
    displayNameSpoofingDetected: r.display_name_spoofing_detected,
    replyToMismatchDetected: r.reply_to_mismatch_detected,
    urgencyLanguageScore: r.urgency_language_score,
    containsNewIban: r.contains_new_iban,
    ibanChangedInThread: r.iban_changed_in_thread,
    classification: r.classification,
    spamSubcategory: r.spam_subcategory,
    ipReputationFlag: r.ip_reputation_flag,
    heloMismatch: r.helo_mismatch,
    imageToTextRatio: r.image_to_text_ratio,
    confidenceScore: r.confidence_score,
    analyzedAt: r.analyzed_at,
  };
}

function rowToQuarantine(r: any): QuarantineRecord {
  return {
    id: r.id,
    messageId: r.message_id,
    quarantinedAt: r.quarantined_at,
    reason: r.reason,
    autoDeleteAt: r.auto_delete_at,
    userReviewed: r.user_reviewed,
  };
}

function rowToSecurityAuditLog(r: any): SecurityAuditLogRecord {
  return { id: r.id, userId: r.user_id, messageId: r.message_id, action: r.action, timestamp: r.timestamp };
}

function rowToContract(r: any): ContractRecord {
  return {
    id: r.id,
    userId: r.user_id,
    messageId: r.message_id,
    providerName: r.provider_name,
    contractStart: r.contract_start,
    contractEnd: r.contract_end,
    cancellationDeadline: r.cancellation_deadline,
    cancellationPeriodDays: r.cancellation_period_days,
    status: r.status,
    extractedConfidence: r.extracted_confidence,
  };
}

function rowToMessageAiSummary(r: any): MessageAiSummaryRecord {
  return {
    messageId: r.message_id,
    summaryText: r.summary_text,
    actionRequired: r.action_required,
    actionDescription: r.action_description,
    deadline: r.deadline,
    source: r.source,
    generatedAt: r.generated_at,
  };
}

function rowToAiPreference(r: any): AiPreferenceRecord {
  return {
    userId: r.user_id,
    mode: r.mode,
    byokProvider: r.byok_provider,
    encryptedApiKey: r.encrypted_api_key,
    cloudConsentGivenAt: r.cloud_consent_given_at,
    updatedAt: r.updated_at,
  };
}

function rowToOutgoingSendLog(r: any): OutgoingSendLogRecord {
  return {
    id: r.id,
    userId: r.user_id,
    recipientAddress: r.recipient_address,
    sentAt: r.sent_at,
    timeSinceDraftShownMs: r.time_since_draft_shown_ms,
    wasNewRecipient: r.was_new_recipient,
  };
}

function rowToDraft(r: any): DraftRecord {
  return {
    id: r.id,
    userId: r.user_id,
    mailAccountId: r.mail_account_id,
    inReplyToMessageId: r.in_reply_to_message_id,
    toAddresses: r.to_addresses ?? [],
    ccAddresses: r.cc_addresses ?? [],
    subject: r.subject,
    bodyText: r.body_text,
    updatedAt: r.updated_at,
  };
}

function rowToUnsubscribeAction(r: any): UnsubscribeActionRecord {
  return {
    id: r.id,
    userId: r.user_id,
    messageId: r.message_id,
    method: r.method,
    listUnsubscribeHeaderValue: r.list_unsubscribe_header_value,
    status: r.status,
    triggeredAt: r.triggered_at,
    userConfirmedAt: r.user_confirmed_at,
  };
}

function rowToMessageAttachment(r: any): MessageAttachmentRecord {
  return {
    id: r.id,
    messageId: r.message_id,
    uploadedByUserId: r.uploaded_by_user_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    scanStatus: r.scan_status,
    isDangerousType: r.is_dangerous_type,
    scannedAt: r.scanned_at,
    containsSensitiveDocument: r.contains_sensitive_document,
  };
}

export class PostgresStore implements Store {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    configureTypeParsers();
    this.pool = new Pool({ connectionString });
  }

  /** Führt contracts/db-schema.sql aus (alle CREATE TABLE/INDEX sind
   * `IF NOT EXISTS`, siehe dortiger Kopfkommentar -- beliebig oft
   * wiederholbar, kein separates Migrations-Tool nötig für diesen Stand).
   *
   * `migrateFoldersToAccountScope()` MUSS zuerst laufen, nicht danach: das
   * Schema selbst enthält bereits `CREATE INDEX IF NOT EXISTS
   * idx_folders_account ON folders (mail_account_id)` -- auf einer noch
   * nicht migrierten (alten) DB gibt es diese Spalte noch nicht, der
   * gesamte `db-schema.sql`-Batch (eine einzige Simple-Query, faktisch
   * eine implizite Transaktion) würde daran scheitern, BEVOR die Migration
   * überhaupt die Chance hätte, die Spalte anzulegen. */
  async migrate(): Promise<void> {
    await this.migrateFoldersToAccountScope();
    const sql = readFileSync(SCHEMA_PATH, "utf-8");
    await this.pool.query(sql);
  }

  /** [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2, siehe
   * contracts/db-schema.sql-Kommentar bei "folders"): `folders.user_id` ->
   * `mail_account_id`. `CREATE TABLE IF NOT EXISTS` oben ändert eine
   * bereits bestehende Tabelle nie rückwirkend -- auf einer schon vorher
   * angelegten DB existiert die Spalte `user_id` deshalb ggf. noch, ohne
   * `mail_account_id`. Echte, einmalige ALTER-TABLE-Migration (idempotent
   * über `IF EXISTS`/den Spalten-Check unten, kein separater
   * Wiederholungsschutz nötig): Spalte ergänzen, über das (VOR diesem
   * Schritt einzige) Konto jedes betroffenen Users befüllen, alte Spalte +
   * Constraint entfernen. Auf einer frischen DB (Spalte existiert nie) ein
   * sofortiger No-Op. */
  private async migrateFoldersToAccountScope(): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'folders' AND column_name = 'user_id'`,
    );
    if (rows.length === 0) return; // schon migriert oder frische DB

    console.log("[migrate] folders.user_id -> mail_account_id (Mehrfach-Konten-Umbau, WEB_INBOX.md 21.09.)...");

    await this.pool.query(
      `ALTER TABLE folders ADD COLUMN IF NOT EXISTS mail_account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE`,
    );

    // Backfill: vor diesem Schritt hatte jeder User höchstens EIN Konto
    // (alte 1:1-Annahme), die Zuordnung ist deshalb eindeutig.
    await this.pool.query(`
      UPDATE folders f
      SET mail_account_id = (SELECT id FROM mail_accounts m WHERE m.user_id = f.user_id LIMIT 1)
      WHERE f.mail_account_id IS NULL
    `);

    const { rows: orphaned } = await this.pool.query(`SELECT count(*) AS n FROM folders WHERE mail_account_id IS NULL`);
    if (Number(orphaned[0]?.n ?? 0) > 0) {
      throw new Error(
        `[migrate] ${orphaned[0].n} folders-Zeile(n) ohne zuordenbares mail_account gefunden (User ohne Konto?) -- Migration abgebrochen, manuell prüfen.`,
      );
    }

    // Alte Constraint dynamisch finden statt den (nicht garantiert
    // stabilen) Postgres-Auto-Namen zu raten.
    const { rows: constraints } = await this.pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'folders' AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'user_id'
    `);
    for (const c of constraints) {
      await this.pool.query(`ALTER TABLE folders DROP CONSTRAINT IF EXISTS "${c.constraint_name}"`);
    }

    await this.pool.query(`ALTER TABLE folders DROP COLUMN user_id`);
    await this.pool.query(`ALTER TABLE folders ALTER COLUMN mail_account_id SET NOT NULL`);
    await this.pool.query(
      `ALTER TABLE folders ADD CONSTRAINT folders_mail_account_id_system_key_key UNIQUE (mail_account_id, system_key)`,
    );
    await this.pool.query(`DROP INDEX IF EXISTS idx_folders_user`);

    console.log("[migrate] folders.user_id -> mail_account_id abgeschlossen.");
  }

  // ----- Users / Accounts -----

  async createUser(email: string): Promise<User> {
    const { rows } = await this.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING *", [email]);
    return rowToUser(rows[0]);
  }

  async getFirstUser(): Promise<User | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM users ORDER BY created_at ASC LIMIT 1");
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  async createMailAccount(input: Omit<MailAccountRecord, "id">): Promise<MailAccountRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO mail_accounts
         (user_id, provider, email_address, encrypted_oauth_token, encrypted_imap_credentials, sync_status, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.userId,
        input.provider,
        input.emailAddress,
        input.encryptedOauthToken,
        input.encryptedImapCredentials,
        input.syncStatus,
        input.lastSyncedAt,
      ],
    );
    return rowToMailAccount(rows[0]);
  }

  async listMailAccounts(): Promise<MailAccountRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM mail_accounts");
    return rows.map(rowToMailAccount);
  }

  async getMailAccount(id: string): Promise<MailAccountRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM mail_accounts WHERE id = $1", [id]);
    return rows[0] ? rowToMailAccount(rows[0]) : undefined;
  }

  async getMailAccountByUserId(userId: string): Promise<MailAccountRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM mail_accounts WHERE user_id = $1 LIMIT 1", [userId]);
    return rows[0] ? rowToMailAccount(rows[0]) : undefined;
  }

  async listMailAccountsByUserId(userId: string): Promise<MailAccountRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM mail_accounts WHERE user_id = $1", [userId]);
    return rows.map(rowToMailAccount);
  }

  async updateMailAccount(
    id: string,
    patch: Partial<Pick<MailAccountRecord, "syncStatus" | "lastSyncedAt" | "encryptedOauthToken">>,
  ): Promise<MailAccountRecord | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE mail_accounts SET
         sync_status = COALESCE($2, sync_status),
         last_synced_at = COALESCE($3, last_synced_at),
         encrypted_oauth_token = COALESCE($4, encrypted_oauth_token)
       WHERE id = $1
       RETURNING *`,
      [id, patch.syncStatus ?? null, patch.lastSyncedAt ?? null, patch.encryptedOauthToken ?? null],
    );
    return rows[0] ? rowToMailAccount(rows[0]) : undefined;
  }

  // ----- Sessions -----

  async createSession(userId: string): Promise<SessionRecord> {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { rows } = await this.pool.query(
      "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING *",
      [userId, randomUUID(), expiresAt],
    );
    return rowToSession(rows[0]);
  }

  async getSessionByToken(token: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM sessions WHERE token = $1", [token]);
    return rows[0] ? rowToSession(rows[0]) : undefined;
  }

  async refreshSession(token: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE sessions SET token = $2, expires_at = $3
       WHERE token = $1 AND expires_at >= now()
       RETURNING *`,
      [token, randomUUID(), new Date(Date.now() + SESSION_TTL_MS).toISOString()],
    );
    return rows[0] ? rowToSession(rows[0]) : undefined;
  }

  // ----- Ordner -----

  /** NUR für den Migrations-Smoketest (siehe smoketest.ts "Ordner-Umbau-
   * Migration"): `folders_system_key_check` erlaubt seit dem Ordner-Umbau
   * (WEB_INBOX.md 09.09.) nur noch die neue 7er-Liste, 'wichtig' ist damit
   * kein gültiger Wert mehr. Auf einer frisch aus contracts/db-schema.sql
   * aufgesetzten Test-DB verhindert genau das, echte Bestandsdaten von VOR
   * dem Umbau zu simulieren -- auf einer ECHTEN, bereits vorher angelegten
   * Produktions-DB kann so eine Zeile aber sehr wohl noch existieren, weil
   * `CREATE TABLE ... IF NOT EXISTS` eine verschärfte Constraint nie
   * rückwirkend auf eine bestehende Tabelle anwendet. `fn` läuft deshalb mit
   * kurzzeitig entfernter Constraint (Constraint wird danach wiederhergestellt,
   * `fn` muss die simulierte Alt-Zeile selbst wieder entfernen -- hier über
   * migrateLegacySystemFolders(), sonst würde das Wiederherstellen fehlschlagen). */
  async runWithRelaxedSystemKeyConstraint<T>(fn: () => Promise<T>): Promise<T> {
    await this.pool.query("ALTER TABLE folders DROP CONSTRAINT IF EXISTS folders_system_key_check");
    try {
      return await fn();
    } finally {
      await this.pool.query(
        `ALTER TABLE folders ADD CONSTRAINT folders_system_key_check
         CHECK (system_key IN ('eingang', 'entwuerfe', 'gesendet', 'sonstiges', 'quarantaene', 'spam', 'papierkorb'))`,
      );
    }
  }

  async createFolder(input: Omit<FolderRecord, "id">): Promise<FolderRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO folders (mail_account_id, name, icon, is_system, system_key, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.mailAccountId, input.name, input.icon, input.isSystem, input.systemKey, input.sortOrder],
    );
    return rowToFolder(rows[0]);
  }

  async listFolders(accountId: string): Promise<FolderRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM folders WHERE mail_account_id = $1 ORDER BY sort_order ASC", [accountId]);
    return rows.map(rowToFolder);
  }

  async getFolder(id: string): Promise<FolderRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM folders WHERE id = $1", [id]);
    return rows[0] ? rowToFolder(rows[0]) : undefined;
  }

  async getSystemFolder(accountId: string, systemKey: SystemFolderKey): Promise<FolderRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM folders WHERE mail_account_id = $1 AND system_key = $2", [accountId, systemKey]);
    return rows[0] ? rowToFolder(rows[0]) : undefined;
  }

  async updateFolder(
    id: string,
    patch: Partial<Pick<FolderRecord, "name" | "icon" | "sortOrder">>,
  ): Promise<FolderRecord | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE folders SET
         name = COALESCE($2, name),
         icon = COALESCE($3, icon),
         sort_order = COALESCE($4, sort_order)
       WHERE id = $1
       RETURNING *`,
      [id, patch.name ?? null, patch.icon ?? null, patch.sortOrder ?? null],
    );
    return rows[0] ? rowToFolder(rows[0]) : undefined;
  }

  async deleteFolder(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM folders WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  // ----- Messages -----

  async findMessageByHeader(mailAccountId: string, messageIdHeader: string): Promise<MessageRecord | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM messages WHERE mail_account_id = $1 AND message_id_header = $2",
      [mailAccountId, messageIdHeader],
    );
    return rows[0] ? rowToMessage(rows[0]) : undefined;
  }

  // Dedupe für den Auto-Delete-Pfad (adult/gambling-Spam, siehe
  // mail/sync.ts): diese Mails bekommen NIE eine messages-Zeile, deshalb
  // eine eigene, winzige Tabelle statt eines In-Memory-Sets -- sonst würde
  // ein Neustart des Backends dieselbe Mail beim nächsten Sync erneut als
  // "neu" behandeln und ein zweites Mal auto-löschen/loggen.
  async wasAutoDeleted(mailAccountId: string, messageIdHeader: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM auto_deleted_message_headers WHERE mail_account_id = $1 AND message_id_header = $2",
      [mailAccountId, messageIdHeader],
    );
    return rows.length > 0;
  }

  async markAutoDeleted(mailAccountId: string, messageIdHeader: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO auto_deleted_message_headers (mail_account_id, message_id_header) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [mailAccountId, messageIdHeader],
    );
  }

  async insertMessage(input: Omit<MessageRecord, "id">): Promise<MessageRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO messages
         (mail_account_id, message_id_header, provider_message_id, from_address, from_display_name,
          reply_to_address, subject, body_text, received_at, folder_id, raw_headers, in_reply_to_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.mailAccountId,
        input.messageIdHeader,
        input.providerMessageId,
        input.fromAddress,
        input.fromDisplayName,
        input.replyToAddress,
        input.subject,
        input.bodyText,
        input.receivedAt,
        input.folderId,
        input.rawHeaders,
        input.inReplyToMessageId,
      ],
    );
    return rowToMessage(rows[0]);
  }

  async listMessages(filter: { folderId?: string; accountId?: string; q?: string }): Promise<MessageRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.folderId) {
      params.push(filter.folderId);
      conditions.push(`folder_id = $${params.length}`);
    }
    if (filter.accountId) {
      params.push(filter.accountId);
      conditions.push(`mail_account_id = $${params.length}`);
    }
    // [2026-09-21] WEB_INBOX.md 21.09. "2) Suche ueber Mails" -- einfache
    // ILIKE-Substring-Suche ueber Betreff/Absender(-Adresse+Anzeigename)/
    // Volltext, kein eigener Such-Index (tsvector/GIN) fuer diesen ersten
    // Schritt. Reicht fuer die Nachrichtenmengen dieses Entwicklungsstands;
    // bei echtem Wachstum waere ein `tsvector`-Spalte+GIN-Index die naechste
    // Ausbaustufe, ohne dass sich die Store-Schnittstelle aendern muesste.
    if (filter.q && filter.q.trim()) {
      params.push(`%${filter.q.trim()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(subject ILIKE ${p} OR from_address ILIKE ${p} OR from_display_name ILIKE ${p} OR body_text ILIKE ${p})`,
      );
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query(`SELECT * FROM messages ${where} ORDER BY received_at DESC`, params);
    return rows.map(rowToMessage);
  }

  async getMessage(id: string): Promise<MessageRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM messages WHERE id = $1", [id]);
    return rows[0] ? rowToMessage(rows[0]) : undefined;
  }

  async moveMessage(id: string, folderId: string): Promise<MessageRecord | undefined> {
    const { rows } = await this.pool.query("UPDATE messages SET folder_id = $2 WHERE id = $1 RETURNING *", [id, folderId]);
    return rows[0] ? rowToMessage(rows[0]) : undefined;
  }

  async deleteMessage(id: string): Promise<boolean> {
    // message_security/message_ai_summary/quarantine haben ON DELETE CASCADE
    // auf messages.id (siehe db-schema.sql) -- ein DELETE hier reicht.
    const { rowCount } = await this.pool.query("DELETE FROM messages WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  // ----- Security -----

  async setMessageSecurity(record: MessageSecurityRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO message_security
         (message_id, spf_status, dkim_status, dmarc_status, sender_domain_age_days, domain_reputation_score,
          homoglyph_detected, link_mismatch_detected, display_name_spoofing_detected, reply_to_mismatch_detected,
          urgency_language_score, contains_new_iban, iban_changed_in_thread, classification,
          spam_subcategory, ip_reputation_flag, helo_mismatch, image_to_text_ratio, confidence_score, analyzed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (message_id) DO UPDATE SET
         spf_status = EXCLUDED.spf_status,
         dkim_status = EXCLUDED.dkim_status,
         dmarc_status = EXCLUDED.dmarc_status,
         sender_domain_age_days = EXCLUDED.sender_domain_age_days,
         domain_reputation_score = EXCLUDED.domain_reputation_score,
         homoglyph_detected = EXCLUDED.homoglyph_detected,
         link_mismatch_detected = EXCLUDED.link_mismatch_detected,
         display_name_spoofing_detected = EXCLUDED.display_name_spoofing_detected,
         reply_to_mismatch_detected = EXCLUDED.reply_to_mismatch_detected,
         urgency_language_score = EXCLUDED.urgency_language_score,
         contains_new_iban = EXCLUDED.contains_new_iban,
         iban_changed_in_thread = EXCLUDED.iban_changed_in_thread,
         classification = EXCLUDED.classification,
         spam_subcategory = EXCLUDED.spam_subcategory,
         ip_reputation_flag = EXCLUDED.ip_reputation_flag,
         helo_mismatch = EXCLUDED.helo_mismatch,
         image_to_text_ratio = EXCLUDED.image_to_text_ratio,
         confidence_score = EXCLUDED.confidence_score,
         analyzed_at = EXCLUDED.analyzed_at`,
      [
        record.messageId,
        record.spfStatus,
        record.dkimStatus,
        record.dmarcStatus,
        record.senderDomainAgeDays,
        record.domainReputationScore,
        record.homoglyphDetected,
        record.linkMismatchDetected,
        record.displayNameSpoofingDetected,
        record.replyToMismatchDetected,
        record.urgencyLanguageScore,
        record.containsNewIban,
        record.ibanChangedInThread,
        record.classification,
        record.spamSubcategory,
        record.ipReputationFlag,
        record.heloMismatch,
        record.imageToTextRatio,
        record.confidenceScore,
        record.analyzedAt,
      ],
    );
  }

  async getMessageSecurity(messageId: string): Promise<MessageSecurityRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM message_security WHERE message_id = $1", [messageId]);
    return rows[0] ? rowToMessageSecurity(rows[0]) : undefined;
  }

  async hasPhishingMessageFrom(address: string, domain: string | null): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1
         FROM messages m
         JOIN message_security s ON s.message_id = m.id
        WHERE s.classification = 'phishing'
          AND (LOWER(m.from_address) = LOWER($1) OR ($2::text IS NOT NULL AND split_part(LOWER(m.from_address), '@', 2) = $2))
        LIMIT 1`,
      [address, domain],
    );
    return rows.length > 0;
  }

  async hasOtherMessageFromAddress(mailAccountId: string, fromAddress: string, excludingMessageId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM messages WHERE mail_account_id = $1 AND id <> $2 AND LOWER(from_address) = LOWER($3) LIMIT 1",
      [mailAccountId, excludingMessageId, fromAddress],
    );
    return rows.length > 0;
  }

  // ----- Quarantäne -----

  async quarantineMessage(messageId: string, reason: string): Promise<QuarantineRecord> {
    const autoDeleteAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const { rows } = await this.pool.query(
      `INSERT INTO quarantine (message_id, reason, auto_delete_at) VALUES ($1, $2, $3) RETURNING *`,
      [messageId, reason, autoDeleteAt],
    );
    const record = rowToQuarantine(rows[0]);

    // Ordner-Umstellung (SYNC.md, Commit 734781e): der Quarantäne-"Ordner"
    // ist eine echte folders-Zeile pro Konto (seit 21.09. Mehrfach-Konten-
    // Umbau, vorher pro User). Ein Join spart den Umweg über
    // getMessage()+getMailAccount()+getSystemFolder().
    await this.pool.query(
      `UPDATE messages m
         SET folder_id = f.id
         FROM folders f
        WHERE m.id = $1
          AND f.mail_account_id = m.mail_account_id
          AND f.system_key = 'quarantaene'`,
      [messageId],
    );

    return record;
  }

  async getQuarantineForMessage(messageId: string): Promise<QuarantineRecord | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM quarantine WHERE message_id = $1 ORDER BY quarantined_at DESC LIMIT 1",
      [messageId],
    );
    return rows[0] ? rowToQuarantine(rows[0]) : undefined;
  }

  // ----- Sicherheits-Audit-Log -----

  async logSecurityAudit(input: Omit<SecurityAuditLogRecord, "id" | "timestamp">): Promise<SecurityAuditLogRecord> {
    const { rows } = await this.pool.query(
      "INSERT INTO security_audit_log (user_id, message_id, action) VALUES ($1, $2, $3) RETURNING *",
      [input.userId, input.messageId, input.action],
    );
    return rowToSecurityAuditLog(rows[0]);
  }

  async listSecurityAuditLog(filter: { userId?: string; action?: string }): Promise<SecurityAuditLogRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.userId) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (filter.action) {
      params.push(filter.action);
      conditions.push(`action = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query(`SELECT * FROM security_audit_log ${where}`, params);
    return rows.map(rowToSecurityAuditLog);
  }

  // ----- Verträge -----

  async insertContract(input: Omit<ContractRecord, "id">): Promise<ContractRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO contracts
         (user_id, message_id, provider_name, contract_start, contract_end, cancellation_deadline,
          cancellation_period_days, status, extracted_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.userId,
        input.messageId,
        input.providerName,
        input.contractStart,
        input.contractEnd,
        input.cancellationDeadline,
        input.cancellationPeriodDays,
        input.status,
        input.extractedConfidence,
      ],
    );
    return rowToContract(rows[0]);
  }

  async listContracts(): Promise<ContractRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM contracts");
    return rows.map(rowToContract);
  }

  async getContract(id: string): Promise<ContractRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM contracts WHERE id = $1", [id]);
    return rows[0] ? rowToContract(rows[0]) : undefined;
  }

  // Bekannte Grenze: COALESCE kann "Feld nicht im Patch enthalten" nicht von
  // "Feld absichtlich auf null gesetzt" unterscheiden -- ein Patch-Feld mit
  // explizitem `null` bleibt deshalb unverändert statt geleert zu werden.
  // Für den einzigen Aufrufer (POST /contracts/:id/confirm, Nutzer
  // bestätigt/korrigiert Werte) unkritisch, da dort nie absichtlich ein
  // Datumsfeld auf null gesetzt wird. `InMemoryStore.updateContract()`
  // (Object.assign) hat diese Einschränkung nicht.
  async updateContract(id: string, patch: Partial<Omit<ContractRecord, "id">>): Promise<ContractRecord | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE contracts SET
         provider_name = COALESCE($2, provider_name),
         contract_start = COALESCE($3, contract_start),
         contract_end = COALESCE($4, contract_end),
         cancellation_deadline = COALESCE($5, cancellation_deadline),
         cancellation_period_days = COALESCE($6, cancellation_period_days),
         status = COALESCE($7, status),
         extracted_confidence = COALESCE($8, extracted_confidence)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.providerName ?? null,
        patch.contractStart ?? null,
        patch.contractEnd ?? null,
        patch.cancellationDeadline ?? null,
        patch.cancellationPeriodDays ?? null,
        patch.status ?? null,
        patch.extractedConfidence ?? null,
      ],
    );
    return rows[0] ? rowToContract(rows[0]) : undefined;
  }

  // ----- KI-Zusammenfassung (Cache) -----

  async setMessageAiSummary(record: MessageAiSummaryRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO message_ai_summary
         (message_id, summary_text, action_required, action_description, deadline, source, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (message_id) DO UPDATE SET
         summary_text = EXCLUDED.summary_text,
         action_required = EXCLUDED.action_required,
         action_description = EXCLUDED.action_description,
         deadline = EXCLUDED.deadline,
         source = EXCLUDED.source,
         generated_at = EXCLUDED.generated_at`,
      [
        record.messageId,
        record.summaryText,
        record.actionRequired,
        record.actionDescription,
        record.deadline,
        record.source,
        record.generatedAt,
      ],
    );
  }

  async getMessageAiSummary(messageId: string): Promise<MessageAiSummaryRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM message_ai_summary WHERE message_id = $1", [messageId]);
    return rows[0] ? rowToMessageAiSummary(rows[0]) : undefined;
  }

  // ----- AI Capability -----

  async setUserAiCapability(record: UserAiCapabilityRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_ai_capability
         (user_id, platform, device_model, os_version, on_device_supported, active_mode, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, platform) DO UPDATE SET
         device_model = EXCLUDED.device_model,
         os_version = EXCLUDED.os_version,
         on_device_supported = EXCLUDED.on_device_supported,
         active_mode = EXCLUDED.active_mode,
         checked_at = EXCLUDED.checked_at`,
      [
        record.userId,
        record.platform,
        record.deviceModel,
        record.osVersion,
        record.onDeviceSupported,
        record.activeMode,
        record.checkedAt,
      ],
    );
  }

  // ----- KI-Cloud-Einstellung (BYOK, TERMINAL_INBOX.md 21.09. KORREKTUR) -----

  async getAiPreference(userId: string): Promise<AiPreferenceRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM user_ai_preference WHERE user_id = $1", [userId]);
    return rows[0] ? rowToAiPreference(rows[0]) : undefined;
  }

  async setAiPreference(
    userId: string,
    patch: Partial<Pick<AiPreferenceRecord, "mode" | "byokProvider" | "encryptedApiKey" | "cloudConsentGivenAt">>,
  ): Promise<AiPreferenceRecord> {
    const existing = await this.getAiPreference(userId);
    const merged: Omit<AiPreferenceRecord, "updatedAt"> = {
      userId,
      mode: patch.mode ?? existing?.mode ?? "off",
      byokProvider: patch.byokProvider !== undefined ? patch.byokProvider : (existing?.byokProvider ?? null),
      encryptedApiKey: patch.encryptedApiKey !== undefined ? patch.encryptedApiKey : (existing?.encryptedApiKey ?? null),
      cloudConsentGivenAt:
        patch.cloudConsentGivenAt !== undefined ? patch.cloudConsentGivenAt : (existing?.cloudConsentGivenAt ?? null),
    };
    const { rows } = await this.pool.query(
      `INSERT INTO user_ai_preference (user_id, mode, byok_provider, encrypted_api_key, cloud_consent_given_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET
         mode = EXCLUDED.mode,
         byok_provider = EXCLUDED.byok_provider,
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         cloud_consent_given_at = EXCLUDED.cloud_consent_given_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [merged.userId, merged.mode, merged.byokProvider, merged.encryptedApiKey, merged.cloudConsentGivenAt],
    );
    return rowToAiPreference(rows[0]);
  }

  // ----- IBAN-Historie (Grundlage für containsNewIban) -----

  async hasSeenIban(userId: string, senderAddress: string, iban: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM iban_sightings WHERE user_id = $1 AND sender_address = $2 AND iban = $3",
      [userId, senderAddress.toLowerCase(), iban],
    );
    return rows.length > 0;
  }

  async recordIban(userId: string, senderAddress: string, iban: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO iban_sightings (user_id, sender_address, iban) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [userId, senderAddress.toLowerCase(), iban],
    );
  }

  // ----- Ausgehende Sends (Grundlage für recipientReputation) -----

  async hasSentTo(userId: string, recipientAddress: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM outgoing_send_log WHERE user_id = $1 AND LOWER(recipient_address) = LOWER($2) LIMIT 1",
      [userId, recipientAddress],
    );
    return rows.length > 0;
  }

  async recordOutgoingSend(input: {
    userId: string;
    recipientAddress: string;
    timeSinceDraftShownMs?: number | null;
  }): Promise<OutgoingSendLogRecord> {
    const wasNewRecipient = !(await this.hasSentTo(input.userId, input.recipientAddress));
    const { rows } = await this.pool.query(
      `INSERT INTO outgoing_send_log (user_id, recipient_address, time_since_draft_shown_ms, was_new_recipient)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.userId, input.recipientAddress, input.timeSinceDraftShownMs ?? null, wasNewRecipient],
    );
    return rowToOutgoingSendLog(rows[0]);
  }

  // ----- Anhänge -----

  async insertAttachment(input: Omit<MessageAttachmentRecord, "id">): Promise<MessageAttachmentRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO message_attachments
         (message_id, uploaded_by_user_id, filename, mime_type, size_bytes, scan_status, is_dangerous_type, scanned_at, contains_sensitive_document)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.messageId,
        input.uploadedByUserId,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.scanStatus,
        input.isDangerousType,
        input.scannedAt,
        input.containsSensitiveDocument,
      ],
    );
    return rowToMessageAttachment(rows[0]);
  }

  async getAttachment(id: string): Promise<MessageAttachmentRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM message_attachments WHERE id = $1", [id]);
    return rows[0] ? rowToMessageAttachment(rows[0]) : undefined;
  }

  async linkAttachmentsToMessage(ids: string[], messageId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query("UPDATE message_attachments SET message_id = $2 WHERE id = ANY($1::uuid[])", [ids, messageId]);
  }

  // ----- Entwürfe -----

  async createDraft(input: Omit<DraftRecord, "id" | "updatedAt">): Promise<DraftRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO drafts (user_id, mail_account_id, in_reply_to_message_id, to_addresses, cc_addresses, subject, body_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [input.userId, input.mailAccountId, input.inReplyToMessageId, input.toAddresses, input.ccAddresses, input.subject, input.bodyText],
    );
    return rowToDraft(rows[0]);
  }

  async listDrafts(userId: string): Promise<DraftRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM drafts WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
    return rows.map(rowToDraft);
  }

  async getDraft(id: string): Promise<DraftRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM drafts WHERE id = $1", [id]);
    return rows[0] ? rowToDraft(rows[0]) : undefined;
  }

  async updateDraft(
    id: string,
    patch: Partial<Pick<DraftRecord, "toAddresses" | "ccAddresses" | "subject" | "bodyText">>,
  ): Promise<DraftRecord | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE drafts SET
         to_addresses = COALESCE($2, to_addresses),
         cc_addresses = COALESCE($3, cc_addresses),
         subject = COALESCE($4, subject),
         body_text = COALESCE($5, body_text),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, patch.toAddresses ?? null, patch.ccAddresses ?? null, patch.subject ?? null, patch.bodyText ?? null],
    );
    return rows[0] ? rowToDraft(rows[0]) : undefined;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM drafts WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  // ----- Unsubscribe -----

  async insertUnsubscribeAction(input: Omit<UnsubscribeActionRecord, "id" | "triggeredAt">): Promise<UnsubscribeActionRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO unsubscribe_actions (user_id, message_id, method, list_unsubscribe_header_value, status, user_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.userId, input.messageId, input.method, input.listUnsubscribeHeaderValue, input.status, input.userConfirmedAt],
    );
    return rowToUnsubscribeAction(rows[0]);
  }

  async listUnsubscribeActions(filter: { userId?: string; messageId?: string | null }): Promise<UnsubscribeActionRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.userId) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (filter.messageId === null) {
      conditions.push(`message_id IS NULL`);
    } else if (filter.messageId !== undefined) {
      params.push(filter.messageId);
      conditions.push(`message_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query(`SELECT * FROM unsubscribe_actions ${where}`, params);
    return rows.map(rowToUnsubscribeAction);
  }

  // ----- Vertrauenswuerdige Absender -----

  // Adresse wird kleingeschrieben gespeichert (E-Mail-Adressen sind lokal
  // meist case-insensitiv, gleiches Prinzip wie hasSentTo() weiter unten) --
  // sonst würde die UNIQUE(user_id, sender_address)-Constraint "Foo@Bar.com"
  // und "foo@bar.com" fälschlich als zwei verschiedene Absender behandeln.
  async createTrustedSender(input: { userId: string; senderAddress: string }): Promise<TrustedSenderRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO trusted_senders (user_id, sender_address)
       VALUES ($1, LOWER($2))
       ON CONFLICT (user_id, sender_address) DO UPDATE SET sender_address = EXCLUDED.sender_address
       RETURNING *`,
      [input.userId, input.senderAddress],
    );
    return rowToTrustedSender(rows[0]);
  }

  async listTrustedSenders(userId: string): Promise<TrustedSenderRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM trusted_senders WHERE user_id = $1 ORDER BY added_at DESC",
      [userId],
    );
    return rows.map(rowToTrustedSender);
  }

  async getTrustedSender(id: string): Promise<TrustedSenderRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM trusted_senders WHERE id = $1", [id]);
    return rows[0] ? rowToTrustedSender(rows[0]) : undefined;
  }

  async deleteTrustedSender(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM trusted_senders WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  async isTrustedSender(userId: string, senderAddress: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM trusted_senders WHERE user_id = $1 AND LOWER(sender_address) = LOWER($2)",
      [userId, senderAddress],
    );
    return rows.length > 0;
  }
}
