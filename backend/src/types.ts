// driftmail Backend — Typen
//
// Gespiegelt aus contracts/db-schema.sql (interne Modelle) und
// contracts/api-spec.yaml (API-Response-Shapes, camelCase).
// contracts/ai-adapter-interface.ts wird direkt für den KI-Teil verwendet,
// siehe src/ai/types.ts.

export type Provider = "gmail" | "imap";
export type SyncStatus = "pending" | "syncing" | "ok" | "error";
// CONTRACT-ÄNDERUNG (SYNC.md, Commit 734781e): fester Folder-Enum ersetzt
// durch benutzerdefinierte Ordner (Tabelle `folders`). SystemFolderKey
// bleibt als Enum bestehen, aber nur noch für die mitgelieferten
// System-Ordner (folders.system_key) — Nachrichten zeigen jetzt per
// folder_id auf eine echte Ordner-Zeile statt auf diesen String.
// "papierkorb" kam mit dem Papierkorb-/Soft-Delete-Contract-Nachtrag dazu
// (WEB_INBOX.md 08.09. "Fehlende Basis-Funktion entdeckt", Commit 156f0fd).
// [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
// Ordner-Umbau-Eintrags"): "wichtig"/"rechnungen" entfallen als System-Ordner,
// "eingang"/"entwuerfe"/"gesendet" sind neu -- jetzt 7 System-Ordner, siehe
// ensureDemoUser()/migrateLegacySystemFolders() in db/store.ts.
export type SystemFolderKey = "eingang" | "entwuerfe" | "gesendet" | "sonstiges" | "quarantaene" | "spam" | "papierkorb";
export type Classification = "safe" | "spam" | "phishing" | "unclear";
export type ContractStatus = "active" | "cancelled" | "expired" | "needs_review";
export type AiSource = "on_device" | "cloud_fallback";
export type Platform = "ios" | "android" | "windows" | "web";
export type ActiveMode = "on_device" | "cloud_fallback";

// ===== interne Modelle (1:1 zu db-schema.sql) =====

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface MailAccountRecord {
  id: string;
  userId: string;
  provider: Provider;
  emailAddress: string;
  encryptedOauthToken: string | null;
  encryptedImapCredentials: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
}

export interface FolderRecord {
  id: string;
  userId: string;
  name: string;
  icon: string;
  isSystem: boolean;
  systemKey: SystemFolderKey | null;
  sortOrder: number;
}

export interface MessageRecord {
  id: string;
  mailAccountId: string;
  messageIdHeader: string;
  // Provider-natives Handle für Papierkorb/Löschen-Spiegelung (siehe
  // mail/types.ts FetchedMail.providerMessageId für Details/Grenzen).
  // `null` bei Fixture-Nachrichten (kein echtes Postfach dahinter).
  providerMessageId: string | null;
  fromAddress: string;
  fromDisplayName: string | null;
  replyToAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string;
  folderId: string;
  rawHeaders: Record<string, string> | null;
}

// `message_attachments` (db-schema.sql, WEB_INBOX.md 09.09. "Erweiterung
// des Send-Endpunkt-Eintrags von eben"). `messageId` ist null zwischen
// Upload (POST /attachments) und erfolgreichem Versand -- `uploadedByUserId`
// identifiziert den Anhang in dieser Phase stattdessen. Nach POST
// /messages/send wird `messageId` auf die neu entstandene gesendete
// Nachricht nachgetragen (siehe routes/messages.ts).
export interface MessageAttachmentRecord {
  id: string;
  messageId: string | null;
  uploadedByUserId: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  scanStatus: "pending" | "clean" | "malicious" | "blocked_type" | "scan_failed";
  isDangerousType: boolean;
  scannedAt: string | null;
}

// `drafts` (db-schema.sql, WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
// Ordner-Umbau-Eintrags") -- bewusst getrennt von MessageRecord, siehe
// Kommentar dort. Zeigt im "entwuerfe"-Systemordner an, hat aber keinen
// eigenen folderId-Bezug (jeder Entwurf eines Users gehört implizit dorthin).
export interface DraftRecord {
  id: string;
  userId: string;
  mailAccountId: string;
  inReplyToMessageId: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  bodyText: string | null;
  updatedAt: string;
}

export interface MessageSecurityRecord {
  messageId: string;
  spfStatus: "pass" | "fail" | "none" | null;
  dkimStatus: "pass" | "fail" | "none" | null;
  dmarcStatus: "pass" | "fail" | "none" | null;
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null;
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  classification: Classification;
  // Nur gesetzt wenn classification === "spam", siehe ai/types.ts.
  spamSubcategory: "adult" | "gambling" | "generic" | "marketing" | null;
  // Botnetz-Erkennung (WEB_INBOX.md 08.09.), siehe ai/types.ts.
  ipReputationFlag: "clean" | "known_botnet" | "unknown" | null;
  heloMismatch: boolean;
  imageToTextRatio: number | null;
  confidenceScore: number | null;
  analyzedAt: string;
}

export interface MessageLinkRecord {
  id: string;
  messageId: string;
  displayText: string | null;
  actualUrl: string;
  domainMatchesDisplay: boolean;
  isKnownMalicious: boolean;
}

export interface QuarantineRecord {
  id: string;
  messageId: string;
  quarantinedAt: string;
  reason: string;
  autoDeleteAt: string;
  userReviewed: boolean;
}

// Audit-Log (`security_audit_log` in db-schema.sql). `messageId` ist
// nullable, weil der Auto-Delete-Pfad (adult/gambling-Spam) bewusst NIE
// eine messages-Zeile anlegt -- siehe src/mail/sync.ts und README.
export interface SecurityAuditLogRecord {
  id: string;
  userId: string;
  messageId: string | null;
  action: string;
  timestamp: string;
}

export interface ContractRecord {
  id: string;
  userId: string;
  messageId: string;
  providerName: string;
  contractStart: string | null;
  contractEnd: string | null;
  cancellationDeadline: string | null;
  cancellationPeriodDays: number | null;
  status: ContractStatus;
  extractedConfidence: number | null;
}

export interface MessageAiSummaryRecord {
  messageId: string;
  summaryText: string | null;
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null;
  source: AiSource;
  generatedAt: string;
}

export interface UserAiCapabilityRecord {
  userId: string;
  platform: Platform;
  deviceModel: string | null;
  osVersion: string | null;
  onDeviceSupported: boolean;
  activeMode: ActiveMode;
  checkedAt: string;
}

// `outgoing_send_log` (db-schema.sql, WEB_INBOX.md 08.09. "Bot/Human-
// Missbrauchserkennung beim Versand", Commit a5432e6). Bisher nur write-seitig
// als reine Historie genutzt (kein eigener Endpoint dafür) -- Grundlage für
// den Empfänger-Reputations-Lookup, siehe src/lookups/recipientReputationMock.ts.
export interface OutgoingSendLogRecord {
  id: string;
  userId: string;
  recipientAddress: string;
  sentAt: string;
  timeSinceDraftShownMs: number | null;
  wasNewRecipient: boolean;
}

// ===== API-Response-Shapes (camelCase, 1:1 zu api-spec.yaml) =====

export interface ApiMailAccount {
  id: string;
  provider: Provider;
  emailAddress: string;
  syncStatus: SyncStatus;
}

export interface ApiFolder {
  id: string;
  name: string;
  icon: string;
  isSystem: boolean;
  systemKey: SystemFolderKey | null;
  sortOrder: number;
}

export interface ApiMessage {
  id: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string | null;
  receivedAt: string;
  folderId: string;
  classification: Classification;
}

export interface ApiDraft {
  id: string;
  inReplyToMessageId: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  bodyText: string | null;
  updatedAt: string;
}

export interface ApiSecurityResult {
  spfStatus: "pass" | "fail" | "none" | null;
  dkimStatus: "pass" | "fail" | "none" | null;
  dmarcStatus: "pass" | "fail" | "none" | null;
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null;
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  classification: Classification;
  spamSubcategory: "adult" | "gambling" | "generic" | "marketing" | null;
  ipReputationFlag: "clean" | "known_botnet" | "unknown" | null;
  heloMismatch: boolean;
  imageToTextRatio: number | null;
  confidenceScore: number | null;
}

export interface ApiQuarantineInfo {
  reason: string;
  autoDeleteAt: string;
  userReviewed: boolean;
}

export interface ApiMessageDetail extends ApiMessage {
  bodyText: string | null;
  security: ApiSecurityResult | null;
  quarantine: ApiQuarantineInfo | null;
}

export interface ApiMailSummary {
  summaryText: string;
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null;
  source: AiSource;
}

export interface ApiContract {
  id: string;
  providerName: string;
  contractStart: string | null;
  contractEnd: string | null;
  cancellationDeadline: string | null;
  cancellationPeriodDays: number | null;
  status: ContractStatus;
  extractedConfidence: number | null;
}

export interface ApiUserAiCapability {
  platform: Platform;
  deviceModel: string | null;
  osVersion: string | null;
  onDeviceSupported: boolean;
  activeMode: ActiveMode;
}

// ===== POST /messages/draft/phishing-check (WEB_INBOX.md 08.09.,
// "Ausgehender Phishing-Check im Composer" + Erweiterung) =====
// Kein AiAdapter-Bestandteil (contracts/ai-adapter-interface.ts kennt diese
// Funktion nicht) -- eigener Endpoint, siehe api-spec.yaml. Nutzt seit der
// Integration (09.09.) die echte Erkennungslogik von Track B
// (@driftmail/security-classification, checkDraftForPhishing()), siehe
// src/routes/messages.ts.

export interface ApiDraftPhishingCheckLink {
  displayText: string | null;
  actualUrl: string;
}

export type SensitiveDataKind = "iban" | "credit_card" | "other";
export type RecipientReputation = "safe" | "unknown" | "flagged";

export interface ApiRiskyLink {
  url: string;
  reason: string;
}

export interface ApiDraftPhishingCheckResult {
  blocked: boolean;
  reason: string | null;
  containsSensitiveData: SensitiveDataKind[];
  recipientReputation: RecipientReputation;
  riskyLinks: ApiRiskyLink[];
}
