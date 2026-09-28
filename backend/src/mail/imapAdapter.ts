// IMAP-Adapter über imapflow + mailparser. Funktioniert mit jedem
// Standard-IMAP-Provider (nicht nur Gmail) — für Nutzer, die ihr Postfach
// nicht per OAuth verbinden (contracts/db-schema.sql:
// mail_accounts.encrypted_imap_credentials).

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { FetchedAttachment, FetchedMail, MailAdapter, SendMailInput, SendMailResult } from "./types";

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
  /** [2026-09-28] Von der automatischen Einrichtung gesetzt, wenn sie auf
   * einen Port ohne TLS ab Verbindungsbeginn ausweicht (IMAP 143, SMTP 587):
   * dann MUSS STARTTLS klappen, sonst keine Anmeldung -- das Passwort geht
   * nie unverschluesselt raus. Fehlt bei aelteren Konten (= wie bisher). */
  requireStartTls?: boolean;
  smtpRequireTls?: boolean;
  /** Absenderadresse beim Versand; wird aus dem Konto gesetzt (mail/sync.ts),
   * weil der Anmeldename auch nur der Teil vor dem "@" sein kann. */
  emailAddress?: string;
}

export class ImapAdapter implements MailAdapter {
  constructor(private creds: ImapCredentials) {}

  // [2026-09-28] Ohne 'error'-Listener brachte ein spaeter Socket-Timeout
  // (z.B. nach einer abgelehnten Anmeldung, die Verbindung blieb offen) den
  // ganzen Server zum Absturz ("Unhandled 'error' event"). Fehler landen
  // jetzt nur im Log; die jeweilige Operation meldet ihren Fehler selbst.
  private client() {
    const client = new ImapFlow({
      host: this.creds.host,
      port: this.creds.port,
      secure: this.creds.secure,
      ...(this.creds.requireStartTls && !this.creds.secure ? { doSTARTTLS: true } : {}),
      auth: { user: this.creds.user, pass: this.creds.password },
      // Standard waeren 90 s -- ein stummer Server (Firewall verwirft
      // Pakete) liess die Kontoanlage so lange haengen, bevor das
      // automatische Ausweichen (mail/connectAssist.ts) ueberhaupt anfing.
      connectionTimeout: 20_000,
      logger: false,
    });
    client.on("error", (err: Error) => {
      console.warn(`[imap] Verbindungsfehler ${this.creds.host}: ${err.message}`);
    });
    return client;
  }

  async testConnection(): Promise<void> {
    const client = this.client();
    try {
      await client.connect();
      await client.logout();
    } catch (err) {
      // Abgelehnte Anmeldung: Verbindung sofort schliessen statt offen
      // haengen lassen (sonst spaeter Socket-Timeout).
      client.close();
      throw err;
    }
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
          // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan":
          // mailparser liefert Anhaenge (inkl. Bytes) bereits fertig geparst
          // mit -- kein zusaetzlicher Fetch-Schritt noetig.
          const attachments: FetchedAttachment[] = parsed.attachments.map((a) => ({
            filename: a.filename ?? "unbenannt",
            mimeType: a.contentType || null,
            content: a.content,
          }));
          results.push({
            messageIdHeader: parsed.messageId ?? `imap-${message.uid}`,
            providerMessageId: String(message.uid),
            fromAddress: fromAddr?.address ?? "unbekannt@unbekannt",
            fromDisplayName: fromAddr?.name || null,
            replyToAddress: parsed.replyTo?.value?.[0]?.address ?? null,
            subject: parsed.subject ?? null,
            bodyText: parsed.text ?? null,
            // [2026-09-21] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies":
            // mailparser liefert `.html` bereits fertig geparst (string bei
            // vorhandenem HTML-Teil, sonst `false`) -- keine eigene
            // MIME-Auswertung noetig, anders als bei Gmail (siehe dort).
            bodyHtml: parsed.html || null,
            receivedAt: (parsed.date ?? new Date()).toISOString(),
            rawHeaders,
            attachments,
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

  // [2026-09-28] Sonderordner des Anbieters (Papierkorb, Gesendet) finden,
  // ohne eigene Namensliste: imapflow wertet die Special-Use-Kennzeichen
  // (RFC 6154) aus und erkennt sonst uebliche Namen in vielen Sprachen samt
  // Namensraum-Praefix ("INBOX.Sent", "Gesendete Elemente", "Papierkorb",
  // "Deleted Items" ...).
  private async specialFolder(client: ImapFlow, use: "\\Trash" | "\\Sent"): Promise<string | null> {
    const boxes = await client.list();
    return boxes.find((b) => b.specialUse === use && b.path.toUpperCase() !== "INBOX")?.path ?? null;
  }

  // Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3, umgesetzt 09.09.):
  // `uid` kommt aus `FetchedMail.providerMessageId` (UID in "INBOX").
  // [2026-09-28] Vorher wurde hier nur das \Deleted-Flag gesetzt: Gmail
  // hat die Mail dadurch nur archiviert, GMX/web.de/Firmenserver zeigten sie
  // im Webmailer weiter durchgestrichen an. Jetzt wie jedes Mailprogramm:
  // in den Papierkorb des Anbieters verschieben; nur wenn es keinen
  // erkennbaren Papierkorb gibt, bleibt es beim Flag.
  async trashMessage(uid: string): Promise<void> {
    const client = this.client();
    await client.connect();
    try {
      const trash = await this.specialFolder(client, "\\Trash");
      const lock = await client.getMailboxLock("INBOX");
      try {
        if (trash) await client.messageMove(uid, trash, { uid: true });
        else await client.messageFlagsAdd(uid, ["\\Deleted"], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async permanentlyDeleteMessage(uid: string, messageIdHeader?: string): Promise<void> {
    const client = this.client();
    await client.connect();
    try {
      // Noch im Posteingang (nur geflaggt oder nie verschoben)?
      const lock = await client.getMailboxLock("INBOX");
      try {
        if (await client.fetchOne(uid, { uid: true }, { uid: true })) {
          // messageDelete() setzt \Deleted und expunged in einem Schritt.
          await client.messageDelete(uid, { uid: true });
          return;
        }
      } finally {
        lock.release();
      }
      // Sonst liegt sie im Papierkorb des Anbieters -- dort per Message-ID
      // suchen, weil sie beim Verschieben eine neue UID bekommen hat.
      const trash = await this.specialFolder(client, "\\Trash");
      if (!trash || !messageIdHeader) return;
      const trashLock = await client.getMailboxLock(trash);
      try {
        const uids = await client.search({ header: { "message-id": messageIdHeader } }, { uid: true });
        if (uids && uids.length > 0) await client.messageDelete(uids, { uid: true });
      } finally {
        trashLock.release();
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
      requireTLS: this.creds.smtpRequireTls ?? false,
      auth: { user: this.creds.user, pass: this.creds.password },
    });
    const from = this.creds.emailAddress ?? this.creds.user;
    const mail: Mail.Options = {
      from: input.fromName ? { name: input.fromName, address: from } : from,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      // nodemailer setzt bcc korrekt nur im SMTP-Envelope (RCPT TO), nie in
      // einen sichtbaren Header -- genau das Verhalten, das eine Blindkopie
      // braucht.
      bcc: input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      text: input.bodyText,
      inReplyTo: input.inReplyToMessageIdHeader ?? undefined,
      references: input.inReplyToMessageIdHeader ?? undefined,
      // [2026-09-28] Anhaenge wirklich mitschicken (vorher nie).
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.mimeType ?? undefined,
      })),
      // Feste Message-ID, damit die Kopie im Gesendet-Ordner (unten) und die
      // verschickte Mail dieselbe ist.
      messageId: `<${randomUUID()}@${from.includes("@") ? from.split("@")[1] : "driftmail.local"}>`,
    };
    const info = await transport.sendMail(mail);
    await this.saveToSentFolder(mail).catch((err: Error) => {
      console.warn(`[imap] Kopie im Gesendet-Ordner fehlgeschlagen (${this.creds.host}): ${err.message}`);
    });
    return { providerMessageId: info.messageId };
  }

  // [2026-09-28] Ueber SMTP verschickte Mails legen viele Anbieter NICHT
  // selbst im Gesendet-Ordner ab (GMX, web.de, iCloud, eigene Server) --
  // in anderen Mailprogrammen fehlte die Mail dann. Wie Thunderbird: Kopie
  // per IMAP APPEND ablegen. Ausnahmen, die selbst ablegen (sonst doppelt):
  // Gmail und Microsoft, sowie jeder Server, bei dem die Mail schon drin ist.
  // Best effort: ein Fehler hier macht den Versand nicht rueckgaengig.
  private async saveToSentFolder(mail: Mail.Options): Promise<void> {
    if (/(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com)$/i.test(this.creds.host)) return;
    const raw = await new MailComposer(mail).compile().build();
    const client = this.client();
    await client.connect();
    try {
      const sent = await this.specialFolder(client, "\\Sent");
      if (!sent) return;
      const lock = await client.getMailboxLock(sent);
      try {
        const already = await client.search({ header: { "message-id": String(mail.messageId) } }, { uid: true });
        if (already && already.length > 0) return;
      } finally {
        lock.release();
      }
      await client.append(sent, raw, ["\\Seen"]);
    } finally {
      await client.logout();
    }
  }

  // [2026-09-28] Weiterleiten mit Original-Anhaengen: dieselbe Nachricht
  // per UID erneut aus INBOX holen (gleiche Mailbox wie beim Import, siehe
  // FetchedMail.providerMessageId) und die Anhaenge wie dort parsen.
  async fetchAttachments(providerMessageId: string): Promise<FetchedAttachment[]> {
    const client = this.client();
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const message = await client.fetchOne(providerMessageId, { source: true }, { uid: true });
        if (!message || !message.source) throw new Error(`IMAP: Nachricht ${providerMessageId} nicht mehr vorhanden`);
        const parsed = await simpleParser(message.source);
        return parsed.attachments.map((a) => ({
          filename: a.filename ?? "unbenannt",
          mimeType: a.contentType || null,
          content: a.content,
        }));
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }
}
