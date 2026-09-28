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
import { decryptBytes } from "../auth/credentialsEncryption";
import { attachmentScanner } from "../lookups";
import type { MessageAttachmentRecord } from "../types";
import { adapterForAccount } from "./sync";
import { checkSendAbuse, computeBodyHash } from "./sendAbuseDetection";
import type { OutgoingAttachment } from "./types";

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
  /** [2026-09-28] Weiterleiten: IDs von Anhaengen EMPFANGENER Nachrichten
   * (MessageAttachment.id aus GET /messages/{id}), die mitgeschickt werden
   * sollen. Inhalt wird im Moment des Sendens frisch beim Provider geholt. */
  forwardAttachmentIds?: unknown;
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

  // [2026-09-28] Anhaenge werden jetzt wirklich verschickt (SYNC.md 28.09.).
  // Vorher wurde hier nur scan_status geprueft und nichts mitgeschickt --
  // und es fehlte die Pruefung, wem ein Anhang gehoert.
  const attachmentIds = stringArray(body.attachmentIds);
  const outgoingAttachments: OutgoingAttachment[] = [];
  for (const attachmentId of attachmentIds) {
    const attachment = await store.getAttachment(attachmentId);
    if (!attachment) {
      return { ok: false, status: 400, body: { error: `unbekannte attachmentId: ${attachmentId}` } };
    }
    if (attachment.uploadedByUserId !== userId || attachment.messageId !== null) {
      // Fremder Upload, oder ein Anhang, der schon an einer Nachricht haengt
      // (empfangen oder bereits verschickt) -- dafuer gibt es
      // forwardAttachmentIds.
      return { ok: false, status: 400, body: { error: `attachmentId ${attachmentId} ist kein eigener, noch nicht verschickter Upload` } };
    }
    if (attachment.scanStatus !== "clean") {
      return {
        ok: false,
        status: 422,
        body: { blocked: true, reason: `Anhang "${attachment.filename}" ist nicht freigegeben (Status: ${attachment.scanStatus})` },
      };
    }
    const pending = await store.getPendingAttachmentContent(attachmentId);
    if (!pending || pending.expiresAt <= new Date().toISOString()) {
      return {
        ok: false,
        status: 410,
        body: { error: `Anhang "${attachment.filename}" ist abgelaufen (max. 24 Stunden gespeichert) -- bitte erneut anhängen` },
      };
    }
    outgoingAttachments.push({ filename: attachment.filename, mimeType: attachment.mimeType, content: decryptBytes(pending.contentEncrypted) });
  }

  const forwardAttachmentIds = stringArray(body.forwardAttachmentIds);
  const forwardedRecords: MessageAttachmentRecord[] = [];
  const forwardByMessage = new Map<string, MessageAttachmentRecord[]>();
  for (const attachmentId of forwardAttachmentIds) {
    const attachment = await store.getAttachment(attachmentId);
    const sourceMessage = attachment?.messageId ? await store.getMessage(attachment.messageId) : undefined;
    const sourceAccount = sourceMessage ? await store.getMailAccount(sourceMessage.mailAccountId) : undefined;
    if (!attachment || !sourceMessage || !sourceAccount || sourceAccount.userId !== userId) {
      return { ok: false, status: 400, body: { error: `unbekannter Anhang zum Weiterleiten: ${attachmentId}` } };
    }
    if (attachment.scanStatus !== "clean" || attachment.isDangerousType) {
      return {
        ok: false,
        status: 422,
        body: { blocked: true, reason: `Anhang "${attachment.filename}" ist gesperrt und wird nicht weitergeleitet` },
      };
    }
    forwardedRecords.push(attachment);
    const list = forwardByMessage.get(sourceMessage.id) ?? [];
    list.push(attachment);
    forwardByMessage.set(sourceMessage.id, list);
  }
  for (const [sourceMessageId, records] of forwardByMessage) {
    const sourceMessage = (await store.getMessage(sourceMessageId))!;
    const sourceAccount = (await store.getMailAccount(sourceMessage.mailAccountId))!;
    const unavailable = {
      ok: false as const,
      status: 409,
      body: { error: "Die Original-Anhänge sind beim Mail-Anbieter nicht mehr verfügbar" },
    };
    if (!sourceMessage.providerMessageId) return unavailable;
    let fetched;
    try {
      fetched = await adapterForAccount(sourceAccount).fetchAttachments(sourceMessage.providerMessageId);
    } catch (err) {
      console.error("Original-Anhaenge konnten nicht geholt werden:", err);
      return unavailable;
    }
    for (const record of records) {
      // Zuordnung ueber Dateiname + Groesse (beim Import gespeichert), nicht
      // ueber die Position -- die Reihenfolge der gespeicherten Datensaetze
      // ist in Postgres nicht garantiert.
      const match =
        fetched.find((f) => f.filename === record.filename && f.content.length === record.sizeBytes) ??
        fetched.find((f) => f.filename === record.filename);
      if (!match) return unavailable;
      // Erneut scannen: der Inhalt kommt frisch vom Provider, nicht aus der
      // damals geprueften Kopie.
      const rescan = await attachmentScanner.scan({
        filename: match.filename,
        mimeType: match.mimeType,
        sizeBytes: match.content.length,
        buffer: match.content,
      });
      if (rescan.scanStatus !== "clean" || rescan.isDangerousType) {
        return {
          ok: false,
          status: 422,
          body: { blocked: true, reason: `Anhang "${record.filename}" ist gesperrt und wird nicht weitergeleitet` },
        };
      }
      outgoingAttachments.push({ filename: match.filename, mimeType: match.mimeType, content: match.content });
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
    const result = await adapter.sendMail({
      fromName: (await store.getUserById(account.userId))?.displayName ?? null,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      inReplyToMessageIdHeader: inReplyToHeader,
      attachments: outgoingAttachments,
    });
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
      // [2026-09-27] Nur To/Cc (kein Bcc), damit die Detailansicht die
      // Empfaenger zeigen kann -- siehe mappers.ts recipientsFromHeader.
      rawHeaders: { To: to.join(", "), ...(cc.length > 0 ? { Cc: cc.join(", ") } : {}) },
      inReplyToMessageId,
      confidentialUntil,
      snoozedUntil: null,
    });
    if (attachmentIds.length > 0) await store.linkAttachmentsToMessage(attachmentIds, sentMessage.id);
    // Weitergeleitete Anhaenge bleiben am Original; die Gesendet-Kopie
    // bekommt eigene Metadaten-Eintraege (ohne Inhalt).
    for (const record of forwardedRecords) {
      await store.insertAttachment({
        messageId: sentMessage.id,
        uploadedByUserId: userId,
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        scanStatus: record.scanStatus,
        isDangerousType: record.isDangerousType,
        scannedAt: new Date().toISOString(),
        containsSensitiveDocument: record.containsSensitiveDocument,
      });
    }
  }
  // Inhalt hochgeladener Anhaenge wird nach dem Versand sofort geloescht.
  await store.deletePendingAttachmentContent(attachmentIds);

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
