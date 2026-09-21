// Mapping interne Records (snake_case-Semantik aus db-schema.sql) ->
// API-Response-Shapes (camelCase aus api-spec.yaml).

import { parseListUnsubscribeHeader } from "./mail/listUnsubscribe";
import type {
  AbsenceResponderRecord,
  ApiAbsenceResponder,
  ApiContract,
  ApiDraft,
  ApiFolder,
  ApiMailAccount,
  ApiMailSummary,
  ApiMessage,
  ApiMessageAttachment,
  ApiMessageDetail,
  ApiQuarantineInfo,
  ApiSecurityResult,
  ApiSignature,
  ApiTrustedSender,
  ContractRecord,
  DraftRecord,
  FolderRecord,
  MailAccountRecord,
  MessageAiSummaryRecord,
  MessageAttachmentRecord,
  MessageRecord,
  MessageSecurityRecord,
  QuarantineRecord,
  SignatureRecord,
  TrustedSenderRecord,
} from "./types";

export function toApiMailAccount(a: MailAccountRecord): ApiMailAccount {
  return { id: a.id, provider: a.provider, emailAddress: a.emailAddress, syncStatus: a.syncStatus };
}

export function toApiFolder(f: FolderRecord): ApiFolder {
  return {
    id: f.id,
    accountId: f.mailAccountId,
    name: f.name,
    icon: f.icon,
    isSystem: f.isSystem,
    systemKey: f.systemKey,
    sortOrder: f.sortOrder,
  };
}

// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan".
export function toApiMessageAttachment(a: MessageAttachmentRecord): ApiMessageAttachment {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    scanStatus: a.scanStatus,
    isDangerousType: a.isDangerousType,
    containsSensitiveDocument: a.containsSensitiveDocument,
  };
}

export function toApiTrustedSender(t: TrustedSenderRecord): ApiTrustedSender {
  return { id: t.id, senderAddress: t.senderAddress, addedAt: t.addedAt };
}

export function toApiSignature(s: SignatureRecord): ApiSignature {
  return {
    id: s.id,
    mailAccountId: s.mailAccountId,
    contentHtml: s.contentHtml,
    isDefault: s.isDefault,
    applyToNew: s.applyToNew,
    applyToReplies: s.applyToReplies,
  };
}

export function toApiAbsenceResponder(a: AbsenceResponderRecord): ApiAbsenceResponder {
  return { active: a.active, startDate: a.startDate, endDate: a.endDate, subject: a.subject, body: a.body };
}

export function toApiSecurityResult(s: MessageSecurityRecord): ApiSecurityResult {
  return {
    spfStatus: s.spfStatus,
    dkimStatus: s.dkimStatus,
    dmarcStatus: s.dmarcStatus,
    senderDomainAgeDays: s.senderDomainAgeDays,
    domainReputationScore: s.domainReputationScore,
    homoglyphDetected: s.homoglyphDetected,
    linkMismatchDetected: s.linkMismatchDetected,
    displayNameSpoofingDetected: s.displayNameSpoofingDetected,
    replyToMismatchDetected: s.replyToMismatchDetected,
    urgencyLanguageScore: s.urgencyLanguageScore,
    containsNewIban: s.containsNewIban,
    ibanChangedInThread: s.ibanChangedInThread,
    classification: s.classification,
    spamSubcategory: s.spamSubcategory,
    ipReputationFlag: s.ipReputationFlag,
    heloMismatch: s.heloMismatch,
    imageToTextRatio: s.imageToTextRatio,
    confidenceScore: s.confidenceScore,
  };
}

export function toApiMessage(m: MessageRecord, security: MessageSecurityRecord | undefined, awaitingReply: boolean): ApiMessage {
  return {
    id: m.id,
    fromAddress: m.fromAddress,
    fromDisplayName: m.fromDisplayName,
    subject: m.subject,
    receivedAt: m.receivedAt,
    folderId: m.folderId,
    classification: security?.classification ?? "unclear",
    // [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES", Punkt 4
    // "Threaded Ansicht": vorher nur auf MessageDetail vorhanden -- der
    // Client braucht das aber schon in der LISTE, um Nachrichten client-
    // seitig gruppieren zu koennen, ohne fuer jede einzeln GET /messages/:id
    // nachzuladen.
    inReplyToMessageId: m.inReplyToMessageId,
    // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
    // ("Nudge") -- siehe mail/nudge.ts.
    awaitingReply,
    // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
    // ("Vertraulicher Modus"). `m.bodyText` ist zu diesem Zeitpunkt schon
    // vom Store abgelaufen-geloescht, falls faellig (siehe
    // mail/confidential.ts) -- hier nur reines Durchreichen.
    confidentialUntil: m.confidentialUntil,
  };
}

function toApiQuarantineInfo(q: QuarantineRecord): ApiQuarantineInfo {
  return { reason: q.reason, autoDeleteAt: q.autoDeleteAt, userReviewed: q.userReviewed };
}

export function toApiMessageDetail(
  m: MessageRecord,
  security: MessageSecurityRecord | undefined,
  quarantine: QuarantineRecord | undefined,
  isNewSender: boolean,
  awaitingReply: boolean,
  attachments: MessageAttachmentRecord[],
): ApiMessageDetail {
  return {
    ...toApiMessage(m, security, awaitingReply),
    bodyText: m.bodyText,
    security: security ? toApiSecurityResult(security) : null,
    quarantine: quarantine ? toApiQuarantineInfo(quarantine) : null,
    canUnsubscribe: parseListUnsubscribeHeader(m.rawHeaders) !== null,
    isNewSender,
    attachments: attachments.map(toApiMessageAttachment),
  };
}

export function toApiContract(c: ContractRecord): ApiContract {
  return {
    id: c.id,
    providerName: c.providerName,
    contractStart: c.contractStart,
    contractEnd: c.contractEnd,
    cancellationDeadline: c.cancellationDeadline,
    cancellationPeriodDays: c.cancellationPeriodDays,
    status: c.status,
    extractedConfidence: c.extractedConfidence,
  };
}

export function toApiDraft(d: DraftRecord): ApiDraft {
  return {
    id: d.id,
    inReplyToMessageId: d.inReplyToMessageId,
    to: d.toAddresses,
    cc: d.ccAddresses,
    subject: d.subject,
    bodyText: d.bodyText,
    updatedAt: d.updatedAt,
  };
}

export function toApiMailSummary(s: MessageAiSummaryRecord): ApiMailSummary {
  return {
    summaryText: s.summaryText ?? "",
    actionRequired: s.actionRequired,
    actionDescription: s.actionDescription,
    deadline: s.deadline,
    source: s.source,
  };
}
