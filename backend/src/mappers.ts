// Mapping interne Records (snake_case-Semantik aus db-schema.sql) ->
// API-Response-Shapes (camelCase aus api-spec.yaml).

import type {
  ApiContract,
  ApiFolder,
  ApiMailAccount,
  ApiMailSummary,
  ApiMessage,
  ApiMessageDetail,
  ApiSecurityResult,
  ContractRecord,
  FolderRecord,
  MailAccountRecord,
  MessageAiSummaryRecord,
  MessageRecord,
  MessageSecurityRecord,
} from "./types";

export function toApiMailAccount(a: MailAccountRecord): ApiMailAccount {
  return { id: a.id, provider: a.provider, emailAddress: a.emailAddress, syncStatus: a.syncStatus };
}

export function toApiFolder(f: FolderRecord): ApiFolder {
  return { id: f.id, name: f.name, icon: f.icon, isSystem: f.isSystem, systemKey: f.systemKey, sortOrder: f.sortOrder };
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
    urgencyLanguageScore: s.urgencyLanguageScore,
    containsNewIban: s.containsNewIban,
    classification: s.classification,
    confidenceScore: s.confidenceScore,
  };
}

export function toApiMessage(m: MessageRecord, security: MessageSecurityRecord | undefined): ApiMessage {
  return {
    id: m.id,
    fromAddress: m.fromAddress,
    fromDisplayName: m.fromDisplayName,
    subject: m.subject,
    receivedAt: m.receivedAt,
    folderId: m.folderId,
    classification: security?.classification ?? "unclear",
  };
}

export function toApiMessageDetail(m: MessageRecord, security: MessageSecurityRecord | undefined): ApiMessageDetail {
  return {
    ...toApiMessage(m, security),
    bodyText: m.bodyText,
    security: security ? toApiSecurityResult(security) : null,
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

export function toApiMailSummary(s: MessageAiSummaryRecord): ApiMailSummary {
  return {
    summaryText: s.summaryText ?? "",
    actionRequired: s.actionRequired,
    actionDescription: s.actionDescription,
    deadline: s.deadline,
    source: s.source,
  };
}
