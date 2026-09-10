// Gemeinsames Interface für Mail-Adapter (Gmail, IMAP). Die Sync-Pipeline
// (src/mail/sync.ts) arbeitet nur gegen dieses Interface, nicht gegen die
// konkreten Provider — neue Provider lassen sich ergänzen, ohne die
// Pipeline anzufassen.

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
  receivedAt: string; // ISO datetime
  rawHeaders: Record<string, string>;
}

// POST /messages/send (WEB_INBOX.md 09.09. "Fehlender Senden-Endpunkt"):
// Versand laeuft ausschliesslich ueber die Provider-API des verbundenen
// Kontos (kein eigener Mailserver, gleiches Prinzip wie beim Lesen).
export interface SendMailInput {
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  // RFC822 Message-ID-Header der Ursprungsnachricht (nicht providerMessageId)
  // -- wird als In-Reply-To/References gesetzt, damit Mail-Clients die
  // Antwort im selben Thread einsortieren. `null` bei neuen Mails.
  inReplyToMessageIdHeader: string | null;
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
   * delete) -- Gmail: `users.messages.trash`; IMAP: `\Deleted`-Flag setzen
   * (KEIN Expunge, siehe permanentlyDeleteMessage). `providerMessageId`
   * ist der Wert aus `FetchedMail.providerMessageId` der ursprünglich
   * importierten Nachricht.
   */
  trashMessage(providerMessageId: string): Promise<void>;

  /**
   * Löscht eine Nachricht beim Provider endgültig -- Gmail:
   * `users.messages.delete`; IMAP: `\Deleted`-Flag setzen + Expunge.
   */
  permanentlyDeleteMessage(providerMessageId: string): Promise<void>;
}
