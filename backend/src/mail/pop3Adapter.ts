// POP3-Adapter ueber node-pop3 + mailparser (Massimo: "web.de ist POP3" --
// bisher gab es nur einen IMAP-Adapter, obwohl manche Provider/Nutzer
// bevorzugt POP3 verwenden bzw. IMAP beim Provider gar nicht aktiviert
// haben). Gleiches Interface wie ImapAdapter, damit adapterForAccount()
// (mail/sync.ts) beide Protokolle transparent behandeln kann.
//
// WICHTIGSTER Unterschied zu IMAP: POP3 kennt keine Flags/Ordner auf dem
// Server, nur "Nachricht existiert" oder "geloescht" (DELE, erst nach QUIT
// wirksam). driftmail ruft DELE bewusst NUR bei der expliziten
// "endgueltig loeschen"-Aktion auf (permanentlyDeleteMessage) -- der
// normale Mail-Abruf (fetchRecentMessages) laesst Mails IMMER auf dem
// Server ("leave a copy on server", klassische POP3-Einstellung). Grund:
// viele User rufen dasselbe POP3-Postfach zusaetzlich mit einem anderen
// Programm ab -- wuerde driftmail beim Sync loeschen, waere das ein
// Wettrennen um dieselbe Mail zwischen zwei Programmen (genau das von
// Massimo beobachtete Symptom "Mail wird nicht abgeholt", vermutlich weil
// das ANDERE Programm sie zuerst holt+loescht). trashMessage() (soft
// delete / Papierkorb) kann POP3 grundsaetzlich nicht abbilden (kein
// reversibles Flag) -- bewusst ein No-Op, siehe dortigen Kommentar; der
// lokale Papierkorb-Ordner in driftmail selbst funktioniert trotzdem, nur
// ohne Server-Spiegelung.

// [2026-09-22] KEIN statischer `import Pop3Command from "node-pop3"`: dieses
// Backend ist "type": "commonjs" (package.json), tsx/Node loesen einen
// statischen Import eines Pakets dann ueber dessen "require"-Exportpfad
// auf -- node-pop3s CJS-Build (lib/Command.cjs) ist dort kaputt (wirft
// "helper.cjs does not provide an export named 'listify'" schon beim
// Laden, siehe GitHub-Issue-loses, aber reproduzierbares Paket-eigenes
// Build-Problem, nicht unser Code). Ein dynamisches `await import(...)`
// laedt stattdessen ueber Node's ESM-Loader den funktionierenden
// "import"-Exportpfad (src/Command.js) -- gleiche Klasse, nur ueber den
// nicht-kaputten Ladeweg. Einmal geladen und gecacht (Modul-Cache haelt
// das ohnehin, `cachedPop3Command` spart nur das wiederholte await).
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { FetchedAttachment, FetchedMail, MailAdapter, SendMailInput, SendMailResult } from "./types";
import type Pop3CommandType from "node-pop3";

let cachedPop3Command: typeof Pop3CommandType | undefined;
async function loadPop3Command(): Promise<typeof Pop3CommandType> {
  if (!cachedPop3Command) {
    cachedPop3Command = (await import("node-pop3")).default;
  }
  return cachedPop3Command;
}

export interface Pop3Credentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  // SMTP (Versand) ist bei POP3-Postfaechern -- genau wie bei generischem
  // IMAP -- ein eigener Server/Port, kein Teil von POP3 selbst. Gleiches
  // Feld-Schema wie ImapCredentials, siehe dortigen Kommentar.
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export class Pop3Adapter implements MailAdapter {
  constructor(private creds: Pop3Credentials) {}

  private async client(): Promise<Pop3CommandType> {
    const Pop3Command = await loadPop3Command();
    return new Pop3Command({
      user: this.creds.user,
      password: this.creds.password,
      host: this.creds.host,
      port: this.creds.port,
      tls: this.creds.secure,
    });
  }

  async testConnection(): Promise<void> {
    const client = await this.client();
    await client.STAT();
    await client.QUIT();
  }

  async fetchRecentMessages(limit: number): Promise<FetchedMail[]> {
    const client = await this.client();
    const results: FetchedMail[] = [];
    try {
      const uidlList = (await client.UIDL()) as string[][];
      if (uidlList.length === 0) return results;

      // Wie ImapAdapter.fetchRecentMessages(): nur die letzten `limit`
      // Eintraege (aufsteigende msgNumber == Ankunftsreihenfolge bei den
      // allermeisten POP3-Servern, RFC 1939 schreibt eine feste Reihenfolge
      // aber nicht zwingend vor -- gaengige Praxis, kein Server bekannt,
      // der das anders macht).
      const recent = uidlList.slice(-limit);

      for (const [msgNumRaw, uid] of recent) {
        const msgNum = Number(msgNumRaw);
        const raw = await client.RETR(msgNum);
        const source = typeof raw === "string" ? raw : await (await loadPop3Command()).stream2String(raw);
        const parsed = await simpleParser(source);
        const rawHeaders: Record<string, string> = {};
        parsed.headers.forEach((value: unknown, key: string) => {
          rawHeaders[key] = typeof value === "string" ? value : JSON.stringify(value);
        });

        const fromAddr = parsed.from?.value?.[0];
        const attachments: FetchedAttachment[] = parsed.attachments.map((a) => ({
          filename: a.filename ?? "unbenannt",
          mimeType: a.contentType || null,
          content: a.content,
        }));
        results.push({
          messageIdHeader: parsed.messageId ?? `pop3-${uid}`,
          providerMessageId: uid,
          fromAddress: fromAddr?.address ?? "unbekannt@unbekannt",
          fromDisplayName: fromAddr?.name || null,
          replyToAddress: parsed.replyTo?.value?.[0]?.address ?? null,
          subject: parsed.subject ?? null,
          bodyText: parsed.text ?? null,
          bodyHtml: parsed.html || null,
          receivedAt: (parsed.date ?? new Date()).toISOString(),
          rawHeaders,
          attachments,
        });
        // BEWUSST kein DELE hier -- siehe Datei-Kopfkommentar ("leave a
        // copy on server").
      }
    } finally {
      await client.QUIT().catch(() => {});
    }
    return results.reverse(); // neueste zuerst, wie ImapAdapter
  }

  /**
   * POP3 kann "in den Papierkorb verschieben" (reversibel) nicht abbilden
   * -- es gibt nur DELE (nach QUIT sofort und endgueltig wirksam) oder gar
   * nichts, kein \Deleted-Flag-ohne-Expunge wie bei IMAP. Bewusst ein
   * No-Op statt einer echten (dann irreversiblen!) Loeschung, die die
   * "Papierkorb"-Semantik brechen wuerde -- der lokale Papierkorb-Ordner
   * in driftmail selbst bleibt unabhaengig davon nutzbar, nur ohne
   * Server-Spiegelung. Ehrlich dokumentierte Grenze statt stillschweigend
   * falschem Verhalten.
   */
  async trashMessage(_providerMessageId: string): Promise<void> {
    return;
  }

  async permanentlyDeleteMessage(providerMessageId: string): Promise<void> {
    const client = await this.client();
    try {
      const uidlList = (await client.UIDL()) as string[][];
      const match = uidlList.find(([, uid]) => uid === providerMessageId);
      if (match) {
        await client.DELE(Number(match[0]));
      }
    } finally {
      await client.QUIT().catch(() => {});
    }
  }

  // Identisch zu ImapAdapter.sendMail() -- POP3 kann wie IMAP nicht senden
  // (reines Abhol-Protokoll), Versand laeuft ueber denselben SMTP-Weg mit
  // denselben Zugangsdaten.
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
      bcc: input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      text: input.bodyText,
      inReplyTo: input.inReplyToMessageIdHeader ?? undefined,
      references: input.inReplyToMessageIdHeader ?? undefined,
    });
    return { providerMessageId: info.messageId };
  }
}
