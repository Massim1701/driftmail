// driftmail Backend — Typen
//
// Gespiegelt aus contracts/db-schema.sql (interne Modelle) und
// contracts/api-spec.yaml (API-Response-Shapes, camelCase).
// contracts/ai-adapter-interface.ts wird direkt für den KI-Teil verwendet,
// siehe src/ai/types.ts.

export type Provider = "gmail" | "imap";
export type SyncStatus = "pending" | "syncing" | "ok" | "error";
export type Folder = "wichtig" | "sonstiges" | "rechnungen" | "quarantaene" | "spam";
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

export interface MessageRecord {
  id: string;
  mailAccountId: string;
  messageIdHeader: string;
  fromAddress: string;
  fromDisplayName: string | null;
  replyToAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string;
  folder: Folder;
  rawHeaders: Record<string, string> | null;
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

// ===== API-Response-Shapes (camelCase, 1:1 zu api-spec.yaml) =====

export interface ApiMailAccount {
  id: string;
  provider: Provider;
  emailAddress: string;
  syncStatus: SyncStatus;
}

export interface ApiMessage {
  id: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string | null;
  receivedAt: string;
  folder: Folder;
  classification: Classification;
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
  confidenceScore: number | null;
}

export interface ApiMessageDetail extends ApiMessage {
  bodyText: string | null;
  security: ApiSecurityResult | null;
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
