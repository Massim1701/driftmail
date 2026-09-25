// Wiederverwendbarer Kern von POST /messages/send (siehe routes/messages.ts)
// -- ausgelagert fuer "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send",
// WEB_INBOX.md 21.09.), damit der Scheduler (mail/scheduler.ts) beim
// automatischen Versand eines faelligen Entwurfs EXAKT denselben Weg nimmt
// (Phishing-Check, Anhang-Gate, outgoing_send_log, gesendet-Ordner) wie ein
// direkter Versand ueber die Route -- gleiches Prinzip wie syncAccount(),
// das ebenfalls sowohl vom manuellen Sync-Endpunkt als auch vom Scheduler
// aufgerufen wird (siehe dortigen Kommentar).

import { store } from "../db/store";
import { checkDraftForPhishing } from "@driftmail/security-classification";
import { adapterForAccount } from "./sync";
import { checkSendAbuse, computeBodyHash } from "./sendAbuseDetection";

const SEND_BODY_URL_REGEX = /https?:\/\/[^\s<>"]+/g;

export interface SendMessageInput {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  bodyText?: unknown;
  inReplyToMessageId?: unknown;
  accountId?: unknown;
  confidentialUntil?: unknown;
  attachmentIds?: unknown;
  draftId?: unknown;
  /** [2026-09-25] WEB_INBOX.md 08.09. "Bot/Human-Missbrauchserkennung beim
   * Versand", siehe sendAbuseDetection.ts -- optional, nur bei Antworten
   * ausgewertet. */
  timeSinceDraftShownMs?: unknown;
}

export type SendMessageResult =
  | { ok: true; sentMessageId: string }
  | { ok: false; status: number; body: Record<string, unknown> };

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

export async function sendMessageForUser(userId: string, body: SendMessageInput): Promise<SendMessageResult> {
  const to = stringArray(body.to);
  const bodyText = typeof body.bodyText === "string" ? body.bodyText : "";
  if (to.length === 0 || !bodyText.trim()) {
    return { ok: false, status: 400, body: { error: "to (mindestens 1 Empfänger) und bodyText sind erforderlich" } };
  }
  const cc = stringArray(body.cc);
  const bcc = stringArray(body.bcc);
  const subject = typeof body.subject === "string" ? body.subject : "";
  const inReplyToMessageId = typeof body.inReplyToMessageId === "string" ? body.inReplyToMessageId : null;

  let confidentialUntil: string | null = null;
  if (body.confidentialUntil !== undefined && body.confidentialUntil !== null) {
    if (typeof body.confidentialUntil !== "string") {
      return { ok: false, status: 400, body: { error: "confidentialUntil muss ein ISO-Zeitstempel-String sein" } };
    }
    const parsed = new Date(body.confidentialUntil);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return { ok: false, status: 400, body: { error: "confidentialUntil muss ein gueltiger, in der Zukunft liegender Zeitpunkt sein" } };
    }
    confidentialUntil = parsed.toISOString();
  }

  let inReplyToHeader: string | null = null;
  let accountId: string | null = typeof body.accountId === "string" ? body.accountId : null;
  if (inReplyToMessageId) {
    const original = await store.getMessage(inReplyToMessageId);
    if (!original) return { ok: false, status: 404, body: { error: "inReplyToMessageId: Nachricht nicht gefunden" } };
    inReplyToHeader = original.messageIdHeader;
    accountId = original.mailAccountId;
  }
  if (!accountId) {
    return { ok: false, status: 400, body: { error: "accountId ist erforderlich, wenn keine inReplyToMessageId angegeben ist" } };
  }
  const account = await store.getMailAccount(accountId);
  if (!account) return { ok: false, status: 400, body: { error: `Mail-Konto nicht gefunden: ${accountId}` } };
  if (account.userId !== userId) {
    return { ok: false, status: 403, body: { error: "Mail-Konto gehört nicht zum angemeldeten User" } };
  }

  const urls: string[] = Array.from(new Set(bodyText.match(SEND_BODY_URL_REGEX) ?? []));
  const links = urls.map((url) => ({ displayText: url, actualUrl: url }));
  const phishingCheck = checkDraftForPhishing(bodyText, links);
  if (phishingCheck.blocked) {
    return {
      ok: false,
      status: 422,
      body: { blocked: true, reason: phishingCheck.reason ?? "Sicherheitsprüfung hat den Versand blockiert" },
    };
  }

  const attachmentIds = stringArray(body.attachmentIds);
  for (const attachmentId of attachmentIds) {
    const attachment = await store.getAttachment(attachmentId);
    if (!attachment) {
      return { ok: false, status: 400, body: { error: `unbekannte attachmentId: ${attachmentId}` } };
    }
    if (attachment.scanStatus !== "clean") {
      return {
        ok: false,
        status: 422,
        body: { blocked: true, reason: `Anhang "${attachment.filename}" ist nicht freigegeben (Status: ${attachment.scanStatus})` },
      };
    }
  }

  const recipients = Array.from(new Set([...to, ...cc, ...bcc].map((a) => a.toLowerCase())));
  const timeSinceDraftShownMs = typeof body.timeSinceDraftShownMs === "number" ? body.timeSinceDraftShownMs : null;
  const abuseCheck = await checkSendAbuse(store, {
    userId: account.userId,
    recipients,
    bodyText,
    isReply: inReplyToMessageId !== null,
    timeSinceDraftShownMs,
  });
  if (abuseCheck.blocked) {
    await store.createAbuseFlag({ userId: account.userId, reason: abuseCheck.blocked.reason, actionTaken: "rate_limited" });
    return { ok: false, status: 429, body: { error: abuseCheck.blocked.message } };
  }

  const adapter = adapterForAccount(account);
  let sentMessageId: string;
  try {
    const result = await adapter.sendMail({ to, cc, bcc, subject, bodyText, inReplyToMessageIdHeader: inReplyToHeader });
    sentMessageId = result.providerMessageId;
  } catch (err) {
    console.error("Versand beim Mail-Provider fehlgeschlagen:", err);
    return { ok: false, status: 502, body: { error: "Versand beim Mail-Provider fehlgeschlagen" } };
  }

  const gesendet = await store.getSystemFolder(account.id, "gesendet");
  if (gesendet) {
    const sentMessage = await store.insertMessage({
      mailAccountId: account.id,
      messageIdHeader: `sent-${sentMessageId}`,
      providerMessageId: sentMessageId,
      fromAddress: account.emailAddress,
      fromDisplayName: null,
      replyToAddress: null,
      subject,
      bodyText,
      bodyHtml: null,
      receivedAt: new Date().toISOString(),
      folderId: gesendet.id,
      rawHeaders: null,
      inReplyToMessageId,
      confidentialUntil,
      snoozedUntil: null,
    });
    if (attachmentIds.length > 0) await store.linkAttachmentsToMessage(attachmentIds, sentMessage.id);
  }

  const draftId = typeof body.draftId === "string" ? body.draftId : null;
  if (draftId) await store.deleteDraft(draftId);

  const bodyHash = computeBodyHash(bodyText);
  for (const recipientAddress of recipients) {
    await store.recordOutgoingSend({ userId: account.userId, recipientAddress, timeSinceDraftShownMs, bodyHash });
  }
  // Erst NACH dem tatsaechlich erfolgreichen Versand vermerken (siehe
  // Kommentar in checkSendAbuse()) -- ein am Provider gescheiterter Versand
  // (502 oben) soll keinen Missbrauchs-Flag hinterlassen.
  for (const reason of abuseCheck.warnReasons) {
    await store.createAbuseFlag({ userId: account.userId, reason, actionTaken: "warned" });
  }

  return { ok: true, sentMessageId };
}
