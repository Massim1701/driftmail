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
// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
// "ECHTE KI-ANBINDUNG" c3ec563): "heuristic" neu -- siehe
// contracts/ai-adapter-interface.ts AiSource-Kommentar fuer die volle
// Begruendung (kein driftmail-finanzierter Cloud-Key, drei ehrlich
// unterschiedene Quellen statt vorher zwei).
export type AiSource = "on_device" | "cloud_fallback" | "heuristic";
export type Platform = "ios" | "android" | "windows" | "web";
export type ActiveMode = "on_device" | "cloud_fallback";

// `user_ai_preference` (db-schema.sql, KORREKTUR 21.09.): BYOK-Einstellung
// des Users fuer Cloud-KI. "off" ist der Default -- kein driftmail-
// finanzierter Cloud-Pfad, nur Geraete-eigene KI (Client-seitig) oder der
// deterministische Heuristik-Fallback. encryptedApiKey ist NIE Teil einer
// API-Response (siehe routes/aiSettings.ts toApiAiSettings()).
export type AiPreferenceMode = "off" | "byok";
export type AiProvider = "anthropic" | "openai" | "google" | "other";

export interface AiPreferenceRecord {
  userId: string;
  mode: AiPreferenceMode;
  byokProvider: AiProvider | null;
  encryptedApiKey: string | null;
  cloudConsentGivenAt: string | null;
  updatedAt: string;
}

// ===== interne Modelle (1:1 zu db-schema.sql) =====

// [2026-09-21] "Einstellungsbereich"-Auftrag (WEB_INBOX.md 21.09.,
// "Ansicht: Akzentfarben-Auswahl") -- siehe contracts/design-tokens.json
// color.accentThemes fuer die 5 moeglichen Werte.
export type AccentTheme = "teal" | "ocean_blue" | "violett" | "koralle" | "ocean_verlauf";

export interface User {
  id: string;
  email: string;
  accentTheme: AccentTheme;
  // [2026-09-21] "FUENF NEUE KOMFORT-FEATURES" Punkt 1 ("Unbekannte
  // Absender streng behandeln"), Default true.
  strictUnknownSenders: boolean;
  // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
  // ("Nudge" -- Erinnerung an unbeantwortete Mails), Default true.
  nudgeUnansweredEnabled: boolean;
  createdAt: string;
}

// `sessions` (db-schema.sql, [2026-09-10] "echte Auth", TERMINAL_INBOX.md
// 09.09.): Opaque-Token pro eingeloggter Sitzung, kein JWT. `token` ist
// intern eindeutig (DB-Constraint), wird aber nie an die API zurückgegeben
// außer im unmittelbaren Login/Refresh-Response (siehe routes/auth.ts).
export interface SessionRecord {
  id: string;
  userId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
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
  mailAccountId: string;
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
  // Thread-Verknuepfung (WEB_INBOX.md 15.09., "IBAN-Wechsel im selben
  // Thread"), aus dem "In-Reply-To"-Header aufgeloest gegen
  // messageIdHeader desselben Kontos -- `null`, wenn kein In-Reply-To-Header
  // vorhanden ist oder die referenzierte Nachricht nicht synchronisiert
  // wurde. Siehe mail/inReplyTo.ts.
  inReplyToMessageId: string | null;
  // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
  // ("Vertraulicher Modus"): Ablaufdatum, danach wird bodyText serverseitig
  // geloescht (lazy beim naechsten Lesezugriff, siehe mail/confidential.ts).
  // `null` = keine Ablaufzeit gesetzt (Normalfall).
  confidentialUntil: string | null;
  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze"): `null` = nicht
  // snoozed. In der Zukunft = aus GET /messages ausgeblendet, siehe
  // store.listMessages().
  snoozedUntil: string | null;
}

// `message_attachments` (db-schema.sql, WEB_INBOX.md 09.09. "Erweiterung
// des Send-Endpunkt-Eintrags von eben"). `messageId` ist null zwischen
// Upload (POST /attachments) und erfolgreichem Versand -- `uploadedByUserId`
// identifiziert den Anhang in dieser Phase stattdessen. Nach POST
// /messages/send wird `messageId` auf die neu entstandene gesendete
// Nachricht nachgetragen (siehe routes/messages.ts).
// [2026-09-15] WEB_INBOX.md "Sensible-Daten-Erkennung um Fotos von
// Ausweisen/Kreditkarten erweitern": per OCR ermittelt, nur für
// Bild-Anhänge (sonst immer "none", kein OCR-Versuch), siehe
// attachments/sensitiveDocumentScan.ts.
export type SensitiveDocumentKind = "none" | "credit_card" | "id_document";

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
  containsSensitiveDocument: SensitiveDocumentKind;
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
  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send").
  bccAddresses: string[];
  subject: string | null;
  bodyText: string | null;
  // NULL = normaler Entwurf, gesetzt = wird vom Scheduler automatisch
  // verschickt sobald erreicht (siehe mail/scheduler.ts).
  scheduledFor: string | null;
  updatedAt: string;
}

// `unsubscribe_actions` (db-schema.sql, WEB_INBOX.md 09.09. "Automatisches
// Abmelden bei Spam"). `messageId` ist null für die automatische Abmeldung
// bei adult/gambling-Spam (Auto-Delete-Regel: dafür entsteht nie eine
// messages-Zeile, die Abmeldung muss aber VOR dem Verwerfen laufen) --
// `userId` ist deshalb direkt geführt statt nur über message_id ableitbar,
// gleiches Prinzip wie bei SecurityAuditLogRecord.
export interface UnsubscribeActionRecord {
  id: string;
  userId: string;
  messageId: string | null;
  method: "list_unsubscribe_header" | "manual";
  listUnsubscribeHeaderValue: string | null;
  // [2026-09-21] "LUECKE SCHLIESSEN - echter Abmelde-Aufruf" (WEB_INBOX.md
  // 21.09.): "failed" neu -- der Aufruf ist jetzt ein echter Netzwerk-
  // Seiteneffekt (mailto: ueber den Provider-Sende-Mechanismus, https: per
  // HTTP-Request), kann also fehlschlagen (Netzwerkfehler, 4xx/5xx, Timeout,
  // Redirect auf fremde Domain). Siehe mail/listUnsubscribe.ts performUnsubscribe().
  status: "pending_confirmation" | "confirmed" | "rejected" | "failed";
  triggeredAt: string;
  userConfirmedAt: string | null;
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
  displayNameSpoofingDetected: boolean;
  replyToMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  ibanChangedInThread: boolean;
  classification: Classification;
  // Nur gesetzt wenn classification === "spam", siehe ai/types.ts.
  spamSubcategory: "adult" | "gambling" | "generic" | "marketing" | "advance_fee_scam" | null;
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

// `trusted_senders` (db-schema.sql, WEB_INBOX.md 15.09. "Whitelist fuer
// vertrauenswuerdige Absender"). Bewusste User-Entscheidung, keine
// automatische Klassifikation -- siehe mail/sync.ts für die Wirkung.
export interface TrustedSenderRecord {
  id: string;
  userId: string;
  senderAddress: string;
  addedAt: string;
}

// ===== API-Response-Shapes (camelCase, 1:1 zu api-spec.yaml) =====

export interface ApiMailAccount {
  id: string;
  provider: Provider;
  emailAddress: string;
  syncStatus: SyncStatus;
}

export interface ApiTrustedSender {
  id: string;
  senderAddress: string;
  addedAt: string;
}

export interface ApiFolder {
  id: string;
  accountId: string;
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
  // [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES", Punkt 4
  // "Threaded Ansicht" -- siehe mappers.ts toApiMessage()-Kommentar.
  inReplyToMessageId: string | null;
  // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
  // ("Nudge") -- siehe mail/nudge.ts.
  awaitingReply: boolean;
  // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
  // ("Vertraulicher Modus") -- siehe MessageRecord-Kommentar.
  confidentialUntil: string | null;
  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze") -- siehe
  // MessageRecord-Kommentar.
  snoozedUntil: string | null;
}

export interface ApiDraft {
  id: string;
  inReplyToMessageId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string | null;
  bodyText: string | null;
  scheduledFor: string | null;
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
  displayNameSpoofingDetected: boolean;
  replyToMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  ibanChangedInThread: boolean;
  classification: Classification;
  spamSubcategory: "adult" | "gambling" | "generic" | "marketing" | "advance_fee_scam" | null;
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

export interface ApiMessageAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  scanStatus: MessageAttachmentRecord["scanStatus"];
  isDangerousType: boolean;
  containsSensitiveDocument: SensitiveDocumentKind;
}

export interface ApiMessageDetail extends ApiMessage {
  bodyText: string | null;
  security: ApiSecurityResult | null;
  quarantine: ApiQuarantineInfo | null;
  canUnsubscribe: boolean;
  // "Erster Kontakt"-Kennzeichnung (WEB_INBOX.md 15.09.), siehe api-spec.yaml.
  isNewSender: boolean;
  // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": Anhaenge
  // dieser Nachricht, bereits gescannt (siehe mail/incomingAttachments.ts
  // fuer eingehende, routes/attachments.ts fuer beim Senden hochgeladene).
  attachments: ApiMessageAttachment[];
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

// [2026-09-21] "Abwesenheitsassistent"-Auftrag (WEB_INBOX.md 21.09.,
// "NEUER AUFTRAG - Abwesenheitsassistent"): `signatures` (db-schema.sql)
// existierte im Contract bereits seit dem allerersten Durchstich, wurde
// aber NIE vom echten Backend implementiert (Track E baute die reine
// Auswahl-/Verwaltungslogik als eigenstaendiges `mail-actions`-Package,
// das nie an `backend/` angebunden wurde) -- eine echte Funktionslücke,
// hier nachgezogen, weil der Abwesenheitsassistent eine echte Signatur
// zum Anhaengen braucht. Siehe backend/README.md.
export interface SignatureRecord {
  id: string;
  mailAccountId: string;
  contentHtml: string;
  isDefault: boolean;
  applyToNew: boolean;
  applyToReplies: boolean;
}

export interface ApiSignature {
  id: string;
  mailAccountId: string;
  contentHtml: string;
  isDefault: boolean;
  applyToNew: boolean;
  applyToReplies: boolean;
}

// `absence_responder` (db-schema.sql, "Abwesenheitsassistent"-Auftrag):
// genau eine Zeile pro User (analog zu `user_ai_preference`) -- kein
// eigener Endpunkt pro Mail-Konto, der Abwesenheitstext gilt kontoweit.
// `startDate`/`subject`/`body` sind NULL erlaubt, solange `active=false`
// (noch nie konfiguriert) -- die "Pflicht"-Vorgabe aus dem Auftrag wird
// bei PUT /absence-responder durchgesetzt (siehe routes/), nicht per
// DB-Constraint, damit ein unkonfigurierter User keine Zeile braucht.
export interface AbsenceResponderRecord {
  userId: string;
  active: boolean;
  startDate: string | null; // ISO date
  endDate: string | null; // ISO date, null = unbefristet
  subject: string | null;
  body: string | null;
  updatedAt: string;
}

export interface ApiAbsenceResponder {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
  subject: string | null;
  body: string | null;
}

// `absence_responder_log` (db-schema.sql): Grundlage fuer "pro Absender
// maximal eine Antwort alle X Tage" -- verhindert Antwort-Schleifen bei
// wiederholten Mails derselben Person waehrend der Abwesenheit.
export interface AbsenceResponderLogRecord {
  userId: string;
  senderAddress: string;
  lastSentAt: string;
}

// [2026-09-21] "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 1
// ("Tracking-Pixel-Blockierung") -- siehe backend/README.md fuer die
// wichtige Einordnung, dass blockRemoteImages aktuell ohne technische
// Wirkung ist (driftmail rendert nirgends HTML).
export interface PrivacySettingsRecord {
  userId: string;
  blockRemoteImages: boolean;
  blockTrackingLinks: boolean;
  updatedAt: string;
}

export interface ApiPrivacySettings {
  blockRemoteImages: boolean;
  blockTrackingLinks: boolean;
}

// [2026-09-21] "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 3
// ("Darkweb-/Datenleck-Ueberwachung") -- Mock-Anbindung, siehe
// lookups/dataBreachMock.ts + backend/README.md.
export interface DataBreachFindingRecord {
  id: string;
  mailAccountId: string;
  breachName: string;
  breachDate: string | null;
  discoveredAt: string;
  acknowledged: boolean;
}

export interface ApiDataBreachFinding {
  id: string;
  accountId: string;
  breachName: string;
  breachDate: string | null;
  discoveredAt: string;
  acknowledged: boolean;
}
