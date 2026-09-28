// Gemeinsames Interface für Mail-Adapter (Gmail, IMAP). Die Sync-Pipeline
// (src/mail/sync.ts) arbeitet nur gegen dieses Interface, nicht gegen die
// konkreten Provider — neue Provider lassen sich ergänzen, ohne die
// Pipeline anzufassen.

// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": Anhaenge
// einer EMPFANGENEN Mail, inkl. Bytes (fuer den echten Scan beim Sync,
// siehe mail/incomingAttachments.ts) -- vorher gab es hierfuer ueberhaupt
// kein Feld, eingehende Anhaenge wurden komplett ignoriert.
export interface FetchedAttachment {
  filename: string;
  mimeType: string | null;
  content: Buffer;
}

export interface FetchedMail {
  messageIdHeader: string;
  // Provider-natives Handle für spätere Schreib-Operationen (Papierkorb/
  // Löschen, siehe MailAdapter unten) -- Gmail: die Gmail-Message-ID
  // (users.messages.get/list "id", NICHT der RFC822 Message-ID-Header, mit
  // dem messageIdHeader befüllt ist); IMAP: die UID der Nachricht in der
  // Mailbox, aus der sie gelesen wurde (aktuell immer "INBOX", siehe
  // fetchRecentMessages -- eine IMAP-UID ist nur innerhalb ihrer Mailbox +
  // UIDVALIDITY eindeutig, für diesen Durchstich reicht das, da nie eine
  // andere Mailbox gelesen wird). `null` bei Adaptern ohne echte
  // Provider-Anbindung (Fixture) -- nichts zum Spiegeln vorhanden.
  providerMessageId: string | null;
  fromAddress: string;
  fromDisplayName: string | null;
  replyToAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  // [2026-09-21] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies": roher
  // HTML-Koerper, so wie vom Provider geliefert (NICHT sanitized -- das
  // passiert erst serverseitig beim Ausliefern, siehe mail/htmlSanitize.ts,
  // damit ein spaeter geaenderter blockRemoteImages-Schalter auch fuer
  // laengst synchronisierte Mails rueckwirkend greift). `null` bei reinen
  // Text-Mails oder wenn der Adapter kein HTML liefert.
  bodyHtml: string | null;
  receivedAt: string; // ISO datetime
  rawHeaders: Record<string, string>;
  // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": leeres
  // Array = keine Anhaenge ODER Adapter unterstuetzt (noch) kein Auslesen
  // -- beides fuehrt zum selben, sicheren Verhalten (nichts zu scannen).
  attachments: FetchedAttachment[];
}

// POST /messages/send (WEB_INBOX.md 09.09. "Fehlender Senden-Endpunkt"):
// Versand laeuft ausschliesslich ueber die Provider-API des verbundenen
// Kontos (kein eigener Mailserver, gleiches Prinzip wie beim Lesen).
export interface SendMailInput {
  to: string[];
  cc: string[];
  // [2026-09-21] WEB_INBOX.md 21.09. "3) CC/BCC beim Verfassen" -- bcc wird
  // NUR an die tatsaechliche Provider-API/den SMTP-Envelope gegeben, nie in
  // einen sichtbaren Mail-Header geschrieben (das waere keine Blindkopie
  // mehr), siehe gmailAdapter.ts/imapAdapter.ts.
  bcc: string[];
  subject: string;
  bodyText: string;
  // RFC822 Message-ID-Header der Ursprungsnachricht (nicht providerMessageId)
  // -- wird als In-Reply-To/References gesetzt, damit Mail-Clients die
  // Antwort im selben Thread einsortieren. `null` bei neuen Mails.
  inReplyToMessageIdHeader: string | null;
  // [2026-09-28] Anhaenge werden jetzt wirklich mitgeschickt (vorher gab es
  // dieses Feld gar nicht, hochgeladene Dateien gingen nie raus). Bytes
  // stammen entweder aus dem verschluesselten Kurzzeit-Speicher von
  // POST /attachments oder werden beim Weiterleiten frisch beim Provider
  // geholt (siehe fetchAttachments unten).
  attachments: OutgoingAttachment[];
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string | null;
  content: Buffer;
}

export interface SendMailResult {
  /** Provider-natives Handle der gesendeten Mail, siehe FetchedMail.providerMessageId. */
  providerMessageId: string;
}

export interface MailAdapter {
  /** Verbindungstest / Auth-Check. Wirft bei Fehler. */
  testConnection(): Promise<void>;

  /** Holt die letzten N Nachrichten (neueste zuerst) aus dem Posteingang. */
  fetchRecentMessages(limit: number): Promise<FetchedMail[]>;

  /** Sendet eine neue Mail oder Antwort ueber den Provider. Wirft bei Fehler. */
  sendMail(input: SendMailInput): Promise<SendMailResult>;

  /**
   * Verschiebt eine Nachricht beim Provider in den Papierkorb (soft
   * delete) -- Gmail: `users.messages.trash`; IMAP: [2026-09-28] echtes
   * Verschieben in den Papierkorb-Ordner des Anbieters, nur ohne
   * erkennbaren Papierkorb `\Deleted`-Flag setzen (KEIN Expunge). `providerMessageId`
   * ist der Wert aus `FetchedMail.providerMessageId` der ursprünglich
   * importierten Nachricht.
   */
  trashMessage(providerMessageId: string): Promise<void>;

  /**
   * Löscht eine Nachricht beim Provider endgültig -- Gmail:
   * `users.messages.delete`; IMAP: `\Deleted`-Flag setzen + Expunge.
   * `messageIdHeader` (optional): damit IMAP die Nachricht auch nach dem
   * Verschieben in den Papierkorb wiederfindet (dort hat sie eine neue UID).
   */
  permanentlyDeleteMessage(providerMessageId: string, messageIdHeader?: string): Promise<void>;

  /**
   * [2026-09-28] Weiterleiten mit Original-Anhaengen: holt die Anhaenge
   * einer bereits importierten Nachricht frisch beim Provider (driftmail
   * speichert empfangene Anhaenge bewusst nicht). Reihenfolge wie beim
   * Import, damit die Zuordnung ueber die Position zum gespeicherten
   * Metadaten-Eintrag passt. Wirft, wenn die Nachricht beim Provider nicht
   * mehr existiert.
   */
  fetchAttachments(providerMessageId: string): Promise<FetchedAttachment[]>;
}
