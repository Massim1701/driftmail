// Gemeinsames Interface für Mail-Adapter (Gmail, IMAP). Die Sync-Pipeline
// (src/mail/sync.ts) arbeitet nur gegen dieses Interface, nicht gegen die
// konkreten Provider — neue Provider lassen sich ergänzen, ohne die
// Pipeline anzufassen.

export interface FetchedMail {
  messageIdHeader: string;
  fromAddress: string;
  fromDisplayName: string | null;
  replyToAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string; // ISO datetime
  rawHeaders: Record<string, string>;
}

export interface MailAdapter {
  /** Verbindungstest / Auth-Check. Wirft bei Fehler. */
  testConnection(): Promise<void>;

  /** Holt die letzten N Nachrichten (neueste zuerst) aus dem Posteingang. */
  fetchRecentMessages(limit: number): Promise<FetchedMail[]>;
}
