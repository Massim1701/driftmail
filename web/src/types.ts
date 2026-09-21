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
  // [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): Ordner
  // gehören jetzt zu genau einem Konto ("getrennte Ansichten pro Konto").
  accountId: string;
  name: string;
  icon: string;
  isSystem: boolean;
  systemKey: SystemFolderKey | null;
  sortOrder: number;
}

export type Classification = "safe" | "spam" | "phishing" | "unclear";

// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
// "ECHTE KI-ANBINDUNG" c3ec563): "heuristic" neu -- kein KI-Modell
// beteiligt, deterministische Mustererkennung ohne externen Anbieter.
// Vorher fälschlich immer als "cloud_fallback" gelabelt, obwohl der
// Backend-Mock nie einen echten Cloud-Aufruf machte. Siehe
// backend/README.md "KI-Anbindung (BYOK)".
export type AiSource = "on_device" | "cloud_fallback" | "heuristic";

// GET/PUT /ai-settings (TERMINAL_INBOX.md 21.09. KORREKTUR): eigene
// Cloud-KI-Zugangsdaten des Users (BYOK) -- kein driftmail-finanzierter
// Cloud-Key. apiKey selbst ist nie Teil dieses Typs (wird nie
// zurückgegeben).
export type AiPreferenceMode = "off" | "byok";
export type AiProvider = "anthropic" | "openai" | "google" | "other";

export interface AiSettings {
  mode: AiPreferenceMode;
  byokProvider: AiProvider | null;
  hasApiKey: boolean;
  cloudConsentGiven: boolean;
}

// GET/PUT /settings (WEB_INBOX.md 21.09. "Einstellungsbereich", Ansicht:
// Akzentfarben-Auswahl) -- allgemeine UI-Präferenzen, aktuell nur
// accentTheme. Nur die neutrale Akzentfarbe ist wählbar, siehe
// contracts/design-tokens.json color.accentThemes -- danger/warning/success
// bleiben für alle User fest.
export type AccentTheme = "teal" | "ocean_blue" | "violett" | "koralle" | "ocean_verlauf";

export interface UserSettings {
  accentTheme: AccentTheme;
}

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
  // [2026-09-21] WEB_INBOX.md 19.09. "Sichtbare Kennzeichen/Badges fuer die
  // neuen Sicherheitssignale" -- Felder existieren im Contract/Backend
  // bereits seit den Sicherheits-Ergaenzungen vom 15.09., waren im Web-
  // Client bisher nicht gespiegelt (nur ausgewertet, nicht angezeigt).
  displayNameSpoofingDetected: boolean;
  replyToMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  ibanChangedInThread: boolean;
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
  // "Erster Kontakt"-Kennzeichnung (WEB_INBOX.md 15.09./19.09.): true, wenn
  // es fuer dieses Konto keine andere Nachricht von derselben fromAddress
  // gibt. Kombiniert sich mit GET /trusted-senders -- Badge nur zeigen, wenn
  // isNewSender=true UND Absender nicht auf der Whitelist (siehe api-spec.yaml).
  isNewSender: boolean;
}

// GET/POST/DELETE /trusted-senders (WEB_INBOX.md 15.09. "Whitelist
// vertrauenswuerdiger Absender").
export interface TrustedSender {
  id: string;
  senderAddress: string;
  addedAt: string;
}

// GET /mail-providers (WEB_INBOX.md 15.09. "ECHTE LUECKE ENTDECKT" --
// Provider-Support). Treibt den Onboarding-Provider-Auswahlbildschirm.
export interface MailProvider {
  id: string;
  label: string;
  authType: "oauth" | "imap";
  comingSoon: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  requiresAppPassword: boolean;
  appPasswordHelpUrl: string | null;
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
