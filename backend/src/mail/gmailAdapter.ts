// Gmail-Adapter über die Gmail-API (googleapis).
//
// Erwartet ein bereits autorisiertes OAuth2-Refresh-Token (Consent-Flow ist
// nicht Teil dieses ersten Durchstichs — siehe README "Annahmen"). Ohne
// gesetzte Env-Vars wird dieser Adapter gar nicht instanziiert
// (src/mail/sync.ts fällt dann auf den Fixture-Adapter zurück).

import { google } from "googleapis";
import type { FetchedMail, MailAdapter } from "./types";

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
}
