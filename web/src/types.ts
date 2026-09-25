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
// [2026-09-25] design-tokens.json color.accentThemes: "outlook_blue" neu als
// Default-Theme (WEB_INBOX.md 24.09. "DESIGN-RICHTUNG PRAEZISIERT"), "teal"
// bleibt als wählbare Alternative erhalten (kein Nutzer verliert eine
// bereits getroffene Wahl).
export type AccentTheme = "outlook_blue" | "teal" | "ocean_blue" | "violett" | "koralle" | "ocean_verlauf";

export interface UserSettings {
  accentTheme: AccentTheme;
  // [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt 1
  // ("Unbekannte Absender streng behandeln"), Default true. Reine Client-
  // Darstellungsentscheidung -- steuert nur, ob isNewSender-Nachrichten
  // staerker hervorgehoben werden, das Backend-Signal selbst ist unverändert.
  strictUnknownSenders: boolean;
  // [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-Recherche"
  // Punkt 2 ("Nudge"), Default true -- steuert Message.awaitingReply.
  nudgeUnansweredEnabled: boolean;
}

// [2026-09-21] WEB_INBOX.md "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 1
// ("Tracking-Pixel-Blockierung"). blockRemoteImages hat aktuell KEINE
// technische Wirkung -- driftmail rendert nirgends HTML/laedt nirgends
// automatisch entfernte Bilder (Nachrichtentext ist immer Klartext), siehe
// backend/README.md "Tracking-Schutz". blockTrackingLinks braucht die noch
// nicht implementierte message_links-Extraktion, ebenfalls ohne Wirkung.
export interface PrivacySettings {
  blockRemoteImages: boolean;
  blockTrackingLinks: boolean;
}

// GET/PATCH /security/breaches (WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 3,
// "Darkweb-/Datenleck-Ueberwachung") -- Mock-Anbindung im Backend, siehe
// backend/README.md.
// POST /messages/draft/phishing-check -- WEB_INBOX.md "DREI WEITERE
// FEATURES - Gmail-Recherche" Punkt 3 ("Vertraulicher Modus") nutzt nur
// containsSensitiveData fuer den proaktiven "Vertraulich senden?"-Vorschlag,
// deshalb hier nur ein schlankes Subset des vollen Backend-Schemas.
export interface DraftPhishingCheckResult {
  blocked: boolean;
  reason: string | null;
  containsSensitiveData: Array<"iban" | "credit_card" | "other">;
}

export interface DataBreachFinding {
  id: string;
  accountId: string;
  breachName: string;
  breachDate: string | null;
  discoveredAt: string;
  acknowledged: boolean;
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
  // [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt 4
  // ("Threaded Ansicht") -- vorher nur auf MessageDetail. Zeigt nur den
  // DIREKTEN Elternteil, kein volles Thread-Konzept (siehe backend/README.md).
  inReplyToMessageId: string | null;
  // [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-Recherche"
  // Punkt 2 ("Nudge") -- true, wenn seit mind. 3 Tagen unbeantwortet UND
  // der Schalter (UserSettings.nudgeUnansweredEnabled) an ist. Zur Laufzeit
  // abgeleitet, kein eigenes Feld im Backend-Schema.
  awaitingReply: boolean;
  // [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-Recherche"
  // Punkt 3 ("Vertraulicher Modus") -- nur bei selbst gesendeten Nachrichten
  // gesetzt. Nach Ablauf wird bodyText serverseitig geloescht (siehe
  // MessageDetail.bodyText), dieses Feld bleibt erhalten.
  confidentialUntil: string | null;
  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze") -- solange in
  // der Zukunft, wird die Nachricht aus GET /messages (Liste) ausgeblendet;
  // ueber GET /messages/{id} direkt bleibt sie sichtbar.
  snoozedUntil: string | null;
}

// [2026-09-21] WEB_INBOX.md "WICHTIGE LUECKE ENTDECKT - echter Malware-
// Scan": Anhaenge einer Nachricht, bereits gescannt (ClamAV + Magic-Bytes),
// BEVOR sie hier sichtbar werden. Ein nicht-'clean' Anhang darf die UI
// NICHT zum Oeffnen/Herunterladen anbieten.
export interface MessageAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  scanStatus: AttachmentScanStatus;
  isDangerousType: boolean;
  containsSensitiveDocument: "none" | "credit_card" | "id_document";
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

// [2026-09-22] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies"
// (WEB_INBOX.md, contracts/api-spec.yaml MessageLink): echte <a href>-Links,
// extrahiert aus MessageDetail.bodyHtml beim Sync.
export interface MessageLink {
  id: string;
  displayText: string | null;
  actualUrl: string;
  // false = klassischer Phishing-Indikator (Anzeigetext behauptet eine
  // Domain, das tatsaechliche href-Ziel zeigt auf eine andere).
  domainMatchesDisplay: boolean;
  // Immer false im Backend -- kein externer Blocklist-Abgleich angebunden.
  isKnownMalicious: boolean;
}

export interface MessageDetail extends Message {
  // [2026-09-21] Vertraulicher Modus: kann null sein, wenn confidentialUntil
  // in der Vergangenheit liegt -- der Text wurde dann serverseitig geloescht.
  bodyText: string | null;
  // [2026-09-22] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies": bereits
  // serverseitig SANITISIERT (kein <script>/<style>/<iframe>/<form>, keine
  // Event-Handler-Attribute -- feste Allowlist, siehe backend/README.md).
  // Jeder http(s)-Link ist bereits auf GET /link-check umgeschrieben, jedes
  // <img src> zu einem Remote-Bild ist bereits entfernt, wenn
  // PrivacySettings.blockRemoteImages aktiv ist (Default). null bei reinen
  // Text-Mails oder wenn der Vertrauliche-Modus-Ablauf den Inhalt bereits
  // geloescht hat (gleiche Bedingung wie bodyText oben). MUSS ausschliesslich
  // in einem sandboxed <iframe sandbox="..."> (ohne allow-scripts/
  // allow-same-origin) via srcdoc gerendert werden, NIE per
  // dangerouslySetInnerHTML in den normalen DOM (siehe MessageDetailPane.tsx).
  bodyHtml: string | null;
  security: SecurityResult;
  // [2026-09-22] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies": echte
  // <a href>-Links aus bodyHtml, siehe MessageLink oben. Leeres Array bei
  // reinen Text-Mails.
  links: MessageLink[];
  // Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.): steuert, ob der
  // "Abmelden"-Button für POST /messages/{id}/unsubscribe angezeigt wird --
  // unabhängig von classification (siehe backend/README.md).
  canUnsubscribe: boolean;
  // "Erster Kontakt"-Kennzeichnung (WEB_INBOX.md 15.09./19.09.): true, wenn
  // es fuer dieses Konto keine andere Nachricht von derselben fromAddress
  // gibt. Kombiniert sich mit GET /trusted-senders -- Badge nur zeigen, wenn
  // isNewSender=true UND Absender nicht auf der Whitelist (siehe api-spec.yaml).
  isNewSender: boolean;
  // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan".
  attachments: MessageAttachment[];
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
  // [2026-09-22] api-spec.yaml: "pop3" ergänzt (web.de), war hier nie
  // nachgezogen -- authType-Vergleiche im Code müssen weiterhin nur explizit
  // auf "oauth" prüfen (nicht auf "imap"), damit pop3-Provider denselben
  // IMAP/POP3-Formularweg wie imap-Provider nehmen.
  authType: "oauth" | "imap" | "pop3";
  comingSoon: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  requiresAppPassword: boolean;
  appPasswordHelpUrl: string | null;
  // [2026-09-25] WEB_INBOX.md 21.09. "Anbieter automatisch aus
  // E-Mail-Adresse erkennen": Kleinbuchstaben-Domains ohne "@", die dieser
  // Provider abdeckt (siehe contracts/mail-providers.json "domains"-Note).
  // "other_imap" hat bewusst eine leere Liste.
  domains: string[];
}

// GET/POST /drafts, PATCH/DELETE /drafts/{id} (WEB_INBOX.md 09.09.
// "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"). Zeigt im
// "entwuerfe"-Systemordner an, kommt aber NICHT aus GET /messages.
export interface Draft {
  id: string;
  inReplyToMessageId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string | null;
  bodyText: string | null;
  // [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule
  // Send") -- gesetzt = wird automatisch verschickt, sobald erreicht.
  scheduledFor: string | null;
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

// GET/PUT /absence-responder (WEB_INBOX.md 21.09. "NEUER AUFTRAG -
// Abwesenheitsassistent") -- startDate/endDate als "YYYY-MM-DD"-Strings
// (HTML <input type="date">-Format), endDate optional (automatisches
// Abschalten). Bestehende Default-Signatur wird serverseitig automatisch
// angehängt, kein eigenes Signatur-Feld hier.
export interface AbsenceResponder {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
  subject: string | null;
  body: string | null;
}
