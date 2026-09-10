// Gmail-Adapter über die Gmail-API (googleapis).
//
// Erwartet ein bereits autorisiertes OAuth2-Refresh-Token (Consent-Flow ist
// nicht Teil dieses ersten Durchstichs — siehe README "Annahmen"). Ohne
// gesetzte Env-Vars wird dieser Adapter gar nicht instanziiert
// (src/mail/sync.ts fällt dann auf den Fixture-Adapter zurück).

import { google } from "googleapis";
import type { FetchedMail, MailAdapter, SendMailInput, SendMailResult } from "./types";

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

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string | null {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
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

      results.push({
        messageIdHeader: headerValue(headers, "Message-ID") ?? id,
        providerMessageId: id,
        fromAddress: fromMatch ? fromMatch[2] : fromRaw,
        fromDisplayName: fromMatch ? fromMatch[1].replace(/^"|"$/g, "") || null : null,
        replyToAddress: headerValue(headers, "Reply-To"),
        subject: headerValue(headers, "Subject"),
        bodyText: extractPlainTextBody(payload) ?? full.data.snippet ?? null,
        receivedAt: full.data.internalDate
          ? new Date(Number(full.data.internalDate)).toISOString()
          : new Date().toISOString(),
        rawHeaders,
      });
    }
    return results;
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
  async sendMail(input: SendMailInput): Promise<SendMailResult> {
    const headers = [`To: ${input.to.join(", ")}`];
    if (input.cc.length > 0) headers.push(`Cc: ${input.cc.join(", ")}`);
    headers.push(`Subject: ${input.subject}`);
    if (input.inReplyToMessageIdHeader) {
      headers.push(`In-Reply-To: ${input.inReplyToMessageIdHeader}`);
      headers.push(`References: ${input.inReplyToMessageIdHeader}`);
    }
    headers.push("Content-Type: text/plain; charset=UTF-8");
    const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${input.bodyText}`, "utf-8").toString("base64url");

    const result = await this.client.users.messages.send({ userId: "me", requestBody: { raw } });
    if (!result.data.id) throw new Error("Gmail-Versand: Antwort enthielt keine Message-ID");
    return { providerMessageId: result.data.id };
  }
}
