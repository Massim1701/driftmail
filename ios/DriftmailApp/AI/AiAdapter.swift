import Foundation

/// Swift port of contracts/ai-adapter-interface.ts.
///
/// Every platform implements this protocol with its own code; the shape
/// (function names, input/output) only changes via Track 0. This file is
/// the iOS-native (Swift) implementation of the shared interface.

/// Mirrors `ContractData` in ai-adapter-interface.ts. Distinct from the
/// `Contract` API model (Models/Contract.swift) which additionally carries
/// server-assigned `id`/`status` — ContractData is the raw extraction output
/// before it becomes a persisted Contract row.
struct ContractData: Codable, Hashable {
    let providerName: String
    let contractStart: String?       // ISO date
    let contractEnd: String?         // ISO date
    let cancellationDeadline: String? // ISO date
    let cancellationPeriodDays: Int?
    let extractedConfidence: Double  // 0.0-1.0, low -> UI shows review step
}

/// Mirrors `MailThread` in ai-adapter-interface.ts.
struct MailThread: Codable, Hashable {
    struct ThreadMessage: Codable, Hashable {
        let fromAddress: String
        let subject: String
        let bodyText: String
        let receivedAt: String // ISO datetime
    }
    let messages: [ThreadMessage]
}

/// Mirrors `AiAdapterResult<T>` in ai-adapter-interface.ts — every AI output
/// is tagged with its source so message_ai_summary.source can be filled in.
struct AiAdapterResult<T> {
    let data: T
    let source: AiSource
}

/// Mirrors the `AiAdapter` interface in ai-adapter-interface.ts.
/// analyzeMail / extractContract / summarize / draftReply, 1:1 signature.
protocol AiAdapter {
    /// Analyzes a mail for spam/phishing signals.
    /// Prefers running on-device (iOS/Android/Windows), else cloud fallback.
    func analyzeMail(rawText: String, headers: [String: String]) async throws -> SecurityResult

    /// Extracts contract data from mail content (text or attachment text).
    /// Low extractedConfidence -> UI shows a review step.
    func extractContract(rawText: String) async throws -> ContractData?

    /// Summarizes what the sender wants and what needs to be done.
    /// Triggered on-demand by user tap ("Was wollen die von mir?").
    func summarize(rawText: String) async throws -> MailSummary

    /// Generates a reply draft based on thread context.
    /// Result never goes out automatically — always review/edit/send by the user.
    func draftReply(thread: MailThread) async throws -> String
}
