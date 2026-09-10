// IMAP-Adapter über imapflow + mailparser. Funktioniert mit jedem
// Standard-IMAP-Provider (nicht nur Gmail) — für Nutzer, die ihr Postfach
// nicht per OAuth verbinden (contracts/db-schema.sql:
// mail_accounts.encrypted_imap_credentials).

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { FetchedMail, MailAdapter, SendMailInput, SendMailResult } from "./types";

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  // SMTP (Versand) ist bei generischen IMAP-Providern ein eigener Server/
  // Port, nicht automatisch aus den IMAP-Zugangsdaten ableitbar -- siehe
  // sendMail() unten. In diesem ersten Durchstich per eigenen Env-Vars
  // konfiguriert (gleiches Muster wie IMAP_*, siehe mail/sync.ts).
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export class ImapAdapter implements MailAdapter {
  constructor(private creds: ImapCredentials) {}

  private client() {
    return new ImapFlow({
      host: this.creds.host,
      port: this.creds.port,
      secure: this.creds.secure,
      auth: { user: this.creds.user, pass: this.creds.password },
      logger: false,
    });
  }

  async testConnection(): Promise<void> {
    const client = this.client();
    await client.connect();
    await client.logout();
  }

  async fetchRecentMessages(limit: number): Promise<FetchedMail[]> {
    const client = this.client();
    await client.connect();
    const results: FetchedMail[] = [];
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const total = client.mailbox && "exists" in client.mailbox ? client.mailbox.exists : 0;
        if (total === 0) return results;

        const from = Math.max(1, total - limit + 1);
        for await (const message of client.fetch(`${from}:${total}`, { source: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          const rawHeaders: Record<string, string> = {};
          parsed.headers.forEach((value: unknown, key: string) => {
            rawHeaders[key] = typeof value === "string" ? value : JSON.stringify(value);
          });

          const fromAddr = parsed.from?.value?.[0];
          results.push({
            messageIdHeader: parsed.messageId ?? `imap-${message.uid}`,
            providerMessageId: String(message.uid),
            fromAddress: fromAddr?.address ?? "unbekannt@unbekannt",
            fromDisplayName: fromAddr?.name || null,
            replyToAddress: parsed.replyTo?.value?.[0]?.address ?? null,
            subject: parsed.subject ?? null,
            bodyText: parsed.text ?? null,
            receivedAt: (parsed.date ?? new Date()).toISOString(),
            rawHeaders,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return results.reverse(); // neueste zuerst
  }

  // Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3, umgesetzt 09.09.):
  // `uid` kommt aus `FetchedMail.providerMessageId`. Öffnet dieselbe
  // Mailbox ("INBOX"), aus der auch gelesen wird -- siehe Kommentar bei
  // `FetchedMail.providerMessageId` (types.ts) zur UID/Mailbox-Grenze.
  async trashMessage(uid: string): Promise<void> {
    const client = this.client();
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        // Nur das \Deleted-Flag setzen, noch NICHT expungen -- das
        // entspricht "in den Papierkorb verschieben" (soft delete,
        // umkehrbar durch Entfernen des Flags), nicht dem endgültigen
        // Löschen (siehe permanentlyDeleteMessage).
        await client.messageFlagsAdd(uid, ["\\Deleted"], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async permanentlyDeleteMessage(uid: string): Promise<void> {
    const client = this.client();
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        // messageDelete() setzt \Deleted und expunged in einem Schritt --
        // funktioniert unabhängig davon, ob trashMessage() das Flag vorher
        // schon gesetzt hatte.
        await client.messageDelete(uid, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  // POST /messages/send (WEB_INBOX.md 09.09.): IMAP selbst kann nicht
  // senden (reines Abhol-Protokoll) -- Versand laeuft ueber SMTP mit
  // denselben Nutzer-Zugangsdaten (getrennter Host/Port, siehe
  // ImapCredentials.smtp*). nodemailer setzt Message-ID/Date-Header selbst,
  // `info.messageId` ist der RFC822 Message-ID-Header der gesendeten Mail.
  async sendMail(input: SendMailInput): Promise<SendMailResult> {
    const transport = nodemailer.createTransport({
      host: this.creds.smtpHost,
      port: this.creds.smtpPort,
      secure: this.creds.smtpSecure,
      auth: { user: this.creds.user, pass: this.creds.password },
    });
    const info = await transport.sendMail({
      from: this.creds.user,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      subject: input.subject,
      text: input.bodyText,
      inReplyTo: input.inReplyToMessageIdHeader ?? undefined,
      references: input.inReplyToMessageIdHeader ?? undefined,
    });
    return { providerMessageId: info.messageId };
  }
}
