// Spiegelt contracts/ai-adapter-interface.ts 1:1. Nicht eigenständig ändern —
// Änderungen am Interface laufen über Track 0 (contracts/ai-adapter-interface.ts).
// Diese Datei importiert bewusst nicht direkt aus contracts/, damit backend/
// als eigenständiges npm-Package ohne Pfad-Abhängigkeit außerhalb von
// backend/ baubar bleibt (siehe README "Annahmen").

export type Classification = "safe" | "spam" | "phishing" | "unclear";
export type AiSource = "on_device" | "cloud_fallback";

export interface SecurityResult {
  spfStatus: "pass" | "fail" | "none";
  dkimStatus: "pass" | "fail" | "none";
  dmarcStatus: "pass" | "fail" | "none";
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null;
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null;
  containsNewIban: boolean;
  classification: Classification;
  confidenceScore: number;
}

export interface ContractData {
  providerName: string;
  contractStart: string | null;
  contractEnd: string | null;
  cancellationDeadline: string | null;
  cancellationPeriodDays: number | null;
  extractedConfidence: number;
}

export interface MailSummary {
  summaryText: string;
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null;
}

export interface MailThread {
  messages: Array<{
    fromAddress: string;
    subject: string;
    bodyText: string;
    receivedAt: string;
  }>;
}

export interface AiAdapter {
  analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult>;
  extractContract(rawText: string): Promise<ContractData | null>;
  summarize(rawText: string): Promise<MailSummary>;
  draftReply(thread: MailThread): Promise<string>;
}

export interface AiAdapterResult<T> {
  data: T;
  source: AiSource;
}
