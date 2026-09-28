// Gmail-Adapter über die Gmail-API (googleapis).
//
// Erwartet ein bereits autorisiertes OAuth2-Refresh-Token (Consent-Flow ist
// nicht Teil dieses ersten Durchstichs — siehe README "Annahmen"). Ohne
// gesetzte Env-Vars wird dieser Adapter gar nicht instanziiert
// (src/mail/sync.ts fällt dann auf den Fixture-Adapter zurück).

import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import type { FetchedAttachment, FetchedMail, MailAdapter, SendMailInput, SendMailResult } from "./types";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractPlainTextBody(payload: any): string | null {
  if (!payload) return null;
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = extractPlainTextBody(part);
      if (found) return found;
    }
  }
  return null;
}

// [2026-09-21] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies": exakt
// derselbe rekursive Payload-Walk wie extractPlainTextBody oben, nur für
// den "text/html"-Teil eines multipart/alternative-Payloads (Gmail liefert
// beide Varianten nebeneinander als Geschwister-Parts, siehe API-Doku).
function extractHtmlBody(payload: any): string | null {
  if (!payload) return null;
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = extractHtmlBody(part);
      if (found) return found;
    }
  }
  return null;
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string | null {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": ein Anhang
// ist ein `parts`-Eintrag mit gesetztem `filename` -- anders als der reine
// Textkoerper (extractPlainTextBody oben) traegt Gmail den eigentlichen
// Byte-Inhalt bei "full"-Format NICHT direkt im payload, sondern nur eine
// `body.attachmentId`-Referenz, die separat per `attachments.get`
// nachgeladen werden muss (siehe fetchAttachmentParts unten).
interface GmailAttachmentPart {
  filename: string;
  mimeType: string | null;
  attachmentId: string;
}

function collectAttachmentParts(payload: any, out: GmailAttachmentPart[] = []): GmailAttachmentPart[] {
  if (!payload) return out;
  if (payload.filename && payload.body?.attachmentId) {
    out.push({ filename: payload.filename, mimeType: payload.mimeType || null, attachmentId: payload.body.attachmentId });
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) collectAttachmentParts(part, out);
  }
  return out;
}

export class GmailAdapter implements MailAdapter {
  private client;

  constructor(creds: GmailCredentials) {
    const oAuth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    oAuth2Client.setCredentials({ refresh_token: creds.refreshToken });
    this.client = google.gmail({ version: "v1", auth: oAuth2Client });
  }

  async testConnection(): Promise<void> {
    await this.client.users.getProfile({ userId: "me" });
  }

  async fetchRecentMessages(limit: number): Promise<FetchedMail[]> {
    const list = await this.client.users.messages.list({ userId: "me", maxResults: limit });
    const ids = list.data.messages ?? [];

    const results: FetchedMail[] = [];
    for (const { id } of ids) {
      if (!id) continue;
      const full = await this.client.users.messages.get({ userId: "me", id, format: "full" });
      const payload = full.data.payload;
      const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;
      const rawHeaders: Record<string, string> = {};
      for (const h of headers) rawHeaders[h.name] = h.value;

      const fromRaw = headerValue(headers, "From") ?? "";
      const fromMatch = fromRaw.match(/^(.*?)\s*<(.+)>$/);

      // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": jeder
      // Anhang braucht einen eigenen API-Aufruf fuer die Bytes -- nacheinander
      // statt Promise.all, um bei vielen Anhaengen nicht das Gmail-API-
      // Rate-Limit fuer dieses Konto zu sprengen (gleiches Vorsichtsprinzip
      // wie beim seriellen Nachrichten-Loop hier oben).
      const attachments = await this.loadAttachments(id, payload);

      results.push({
        messageIdHeader: headerValue(headers, "Message-ID") ?? id,
        providerMessageId: id,
        fromAddress: fromMatch ? fromMatch[2] : fromRaw,
        fromDisplayName: fromMatch ? fromMatch[1].replace(/^"|"$/g, "") || null : null,
        replyToAddress: headerValue(headers, "Reply-To"),
        subject: headerValue(headers, "Subject"),
        bodyText: extractPlainTextBody(payload) ?? full.data.snippet ?? null,
        // [2026-09-21] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies"
        bodyHtml: extractHtmlBody(payload),
        receivedAt: full.data.internalDate
          ? new Date(Number(full.data.internalDate)).toISOString()
          : new Date().toISOString(),
        rawHeaders,
        attachments,
      });
    }
    return results;
  }

  private async loadAttachments(
    messageId: string,
    payload: Parameters<typeof collectAttachmentParts>[0],
  ): Promise<FetchedAttachment[]> {
    const attachments: FetchedAttachment[] = [];
    for (const part of collectAttachmentParts(payload)) {
      const attachmentData = await this.client.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.attachmentId,
      });
      if (!attachmentData.data.data) continue;
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        content: Buffer.from(attachmentData.data.data, "base64url"),
      });
    }
    return attachments;
  }

  // [2026-09-28] Weiterleiten mit Original-Anhaengen: Nachricht erneut
  // holen, Anhaenge wie beim Import laden (gleiche Reihenfolge).
  async fetchAttachments(providerMessageId: string): Promise<FetchedAttachment[]> {
    const full = await this.client.users.messages.get({ userId: "me", id: providerMessageId, format: "full" });
    return this.loadAttachments(providerMessageId, full.data.payload);
  }

  // Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3, umgesetzt 09.09.):
  // `id` ist die Gmail-Message-ID aus `FetchedMail.providerMessageId`
  // (NICHT der RFC822 Message-ID-Header).
  async trashMessage(id: string): Promise<void> {
    await this.client.users.messages.trash({ userId: "me", id });
  }

  async permanentlyDeleteMessage(id: string): Promise<void> {
    await this.client.users.messages.delete({ userId: "me", id });
  }

  // POST /messages/send (WEB_INBOX.md 09.09.): baut eine rohe RFC822-Mail
  // und schickt sie per `users.messages.send` -- Gmail setzt Absender/DKIM/
  // SPF selbst anhand des authentifizierten Kontos, ein eigener From-Header
  // ist dafuer nicht noetig. `raw` muss base64url-kodiert sein (analog zu
  // decodeBase64Url oben, nur die Gegenrichtung).
  // [2026-09-28] Die rohe Mail baut jetzt nodemailers MailComposer statt
  // handgeschriebener Header -- noetig fuer Anhaenge (multipart/mixed,
  // Base64, Dateinamen-Kodierung). `keepBcc` behaelt den Bcc-Header in der
  // Rohfassung: Gmails Versand braucht ihn dort und entfernt ihn vor der
  // Zustellung selbst (gleiches Verhalten wie vorher mit dem manuellen
  // Header, siehe Git-Historie).
  async sendMail(input: SendMailInput): Promise<SendMailResult> {
    const mail = new MailComposer({
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      text: input.bodyText,
      inReplyTo: input.inReplyToMessageIdHeader ?? undefined,
      references: input.inReplyToMessageIdHeader ?? undefined,
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.mimeType ?? undefined,
      })),
    }).compile();
    mail.keepBcc = true;
    const raw = (await mail.build()).toString("base64url");

    const result = await this.client.users.messages.send({ userId: "me", requestBody: { raw } });
    if (!result.data.id) throw new Error("Gmail-Versand: Antwort enthielt keine Message-ID");
    return { providerMessageId: result.data.id };
  }
}
