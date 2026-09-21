import Foundation

/// Mirrors `components/schemas/TrustedSender` in contracts/api-spec.yaml
/// (`GET /trusted-senders`, WEB_INBOX.md 15.09. "Whitelist vertrauenswürdiger
/// Absender"). Used to suppress the "Neuer Absender"-badge for senders the
/// user already whitelisted, per `MessageDetail.isNewSender`'s contract
/// description.
struct TrustedSender: Codable, Identifiable, Hashable {
    let id: String
    let senderAddress: String
    let addedAt: Date
}
