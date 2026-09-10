// driftmail — Typen für den Web-Client
//
// Gespiegelt aus contracts/api-spec.yaml und contracts/ai-adapter-interface.ts.
// Bei Contract-Änderungen bitte hier synchron halten (siehe SYNC.md).

// Systemordner-Schlüssel (folders.system_key in db-schema.sql). Ordner selbst
// sind jetzt benutzerdefinierte Objekte (siehe Folder unten) — dies ist nur
// noch der optionale Marker, welcher der 7 Standard-Ordner ein Folder-Objekt
// ist (null bei eigenen Ordnern). [2026-09-10] Ordner-Umbau (WEB_INBOX.md
// 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"): wichtig/
// rechnungen entfallen, eingang/entwuerfe/gesendet sind neu.
export type SystemFolderKey = "eingang" | "entwuerfe" | "gesendet" | "sonstiges" | "quarantaene" | "spam" | "papierkorb";

// POST /attachments Ergebnis (WEB_INBOX.md 09.09. "Erweiterung des
// Send-Endpunkt-Eintrags von eben").
export type AttachmentScanStatus = "pending" | "clean" | "malicious" | "blocked_type" | "scan_failed";

export interface Folder {
  id: string;
  name: string;
  icon: string;
  isSystem: boolean;
  systemKey: SystemFolderKey | null;
  sortOrder: number;
}

export type Classification = "safe" | "spam" | "phishing" | "unclear";

export type AiSource = "on_device" | "cloud_fallback";

export interface MailAccount {
  id: string;
  provider: "gmail" | "imap";
  emailAddress: string;
  syncStatus: "pending" | "syncing" | "ok" | "error";
}

export interface Message {
  id: string;
  fromAddress: string;
  fromDisplayName: string;
  subject: string;
  receivedAt: string;
  folderId: string;
  classification: Classification;
}

export interface SecurityResult {
  spfStatus: "pass" | "fail" | "none";
  dkimStatus: "pass" | "fail" | "none";
  dmarcStatus: "pass" | "fail" | "none";
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null;
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  classification: Classification;
  confidenceScore: number;
}

export interface MessageDetail extends Message {
  bodyText: string;
  security: SecurityResult;
  // Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.): steuert, ob der
  // "Abmelden"-Button für POST /messages/{id}/unsubscribe angezeigt wird --
  // unabhängig von classification (siehe backend/README.md).
  canUnsubscribe: boolean;
}

// GET/POST /drafts, PATCH/DELETE /drafts/{id} (WEB_INBOX.md 09.09.
// "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"). Zeigt im
// "entwuerfe"-Systemordner an, kommt aber NICHT aus GET /messages.
export interface Draft {
  id: string;
  inReplyToMessageId: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  bodyText: string | null;
  updatedAt: string;
}

export interface MailSummary {
  summaryText: string;
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null;
  source: AiSource;
}

export interface Contract {
  id: string;
  providerName: string;
  contractStart: string | null;
  contractEnd: string;
  cancellationDeadline: string;
  cancellationPeriodDays: number;
  status: "active" | "cancelled" | "expired" | "needs_review";
  extractedConfidence: number;
}

export interface UserAiCapability {
  platform: "ios" | "android" | "windows" | "web";
  deviceModel: string;
  osVersion: string;
  onDeviceSupported: boolean;
  activeMode: AiSource;
}
