// Sync-Pipeline: Mail-Adapter -> Store, inkl. Security-Analyse (Mock-KI) und
// automatischer Quarantäne bei classification === "phishing".
//
// In diesem ersten Durchstich wird pro mail_account synchron beim
// Serverstart und über POST /internal/sync (siehe routes) synchronisiert.
// Ein echter Hintergrund-Job/Webhook (Gmail Push, IMAP IDLE) ist bewusst
// nicht Teil dieses Skeletons — siehe README "Annahmen".

import type { MailAccountRecord, Folder } from "../types";
import type { MailAdapter } from "./types";
import { FixtureMailAdapter } from "./fixtureAdapter";
import { GmailAdapter } from "./gmailAdapter";
import { ImapAdapter } from "./imapAdapter";
import { store } from "../db/store";
import type { AiAdapter } from "../ai/types";

/** Wählt den passenden Adapter für ein Konto. Fällt auf den Fixture-Adapter
 * zurück, wenn keine echten Zugangsdaten via Env konfiguriert sind. */
export function adapterForAccount(account: MailAccountRecord): MailAdapter {
  if (account.provider === "gmail") {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (clientId && clientSecret && refreshToken) {
      return new GmailAdapter({ clientId, clientSecret, refreshToken });
    }
  }
  if (account.provider === "imap") {
    const host = process.env.IMAP_HOST;
    const user = process.env.IMAP_USER;
    const password = process.env.IMAP_PASSWORD;
    if (host && user && password) {
      return new ImapAdapter({
        host,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        user,
        password,
      });
    }
  }
  return new FixtureMailAdapter();
}

function classificationToFolder(classification: string, currentFallback: Folder): Folder {
  if (classification === "phishing" || classification === "spam") return "spam";
  return currentFallback;
}

export async function syncAccount(account: MailAccountRecord, ai: AiAdapter, limit = 20): Promise<{ imported: number }> {
  const adapter = adapterForAccount(account);
  account.syncStatus = "syncing";

  let imported = 0;
  try {
    const fetched = await adapter.fetchRecentMessages(limit);

    for (const mail of fetched) {
      if (store.findMessageByHeader(account.id, mail.messageIdHeader)) continue; // dedupe, siehe UNIQUE-Constraint im Schema

      const security = await ai.analyzeMail(mail.bodyText ?? "", mail.rawHeaders);
      const folder = classificationToFolder(security.classification, "sonstiges");

      const message = store.insertMessage({
        mailAccountId: account.id,
        messageIdHeader: mail.messageIdHeader,
        fromAddress: mail.fromAddress,
        fromDisplayName: mail.fromDisplayName,
        replyToAddress: mail.replyToAddress,
        subject: mail.subject,
        bodyText: mail.bodyText,
        receivedAt: mail.receivedAt,
        folder,
        rawHeaders: mail.rawHeaders,
      });

      store.setMessageSecurity({
        messageId: message.id,
        ...security,
        analyzedAt: new Date().toISOString(),
      });

      if (security.classification === "phishing") {
        store.quarantineMessage(message.id, "Automatisch: Phishing-Klassifikation (Mock-KI)");
      }

      // Vertragsdaten best-effort extrahieren (Mock).
      const contractData = await ai.extractContract(mail.bodyText ?? "");
      if (contractData) {
        store.insertContract({
          userId: account.userId,
          messageId: message.id,
          providerName: contractData.providerName,
          contractStart: contractData.contractStart,
          contractEnd: contractData.contractEnd,
          cancellationDeadline: contractData.cancellationDeadline,
          cancellationPeriodDays: contractData.cancellationPeriodDays,
          status: contractData.extractedConfidence < 0.7 ? "needs_review" : "active",
          extractedConfidence: contractData.extractedConfidence,
        });
      }

      imported++;
    }

    account.syncStatus = "ok";
    account.lastSyncedAt = new Date().toISOString();
  } catch (err) {
    account.syncStatus = "error";
    throw err;
  }

  return { imported };
}
