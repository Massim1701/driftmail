// IMAP-Adapter über imapflow + mailparser. Funktioniert mit jedem
// Standard-IMAP-Provider (nicht nur Gmail) — für Nutzer, die ihr Postfach
// nicht per OAuth verbinden (contracts/db-schema.sql:
// mail_accounts.encrypted_imap_credentials).

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { FetchedMail, MailAdapter } from "./types";

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
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
}
