import Foundation

/// Mirrors `components/schemas/MailProvider` in contracts/api-spec.yaml,
/// served by `GET /mail-providers` (`contracts/mail-providers.json`).
/// Drives the onboarding provider-picker (WEB_INBOX.md 19.09.
/// "Onboarding: Provider-Auswahlbildschirm").
struct MailProvider: Codable, Identifiable, Hashable {
    enum AuthType: String, Codable {
        case oauth
        case imap
    }

    let id: String
    let label: String
    let authType: AuthType
    let comingSoon: Bool
    let imapHost: String?
    let imapPort: Int?
    let imapSecure: Bool?
    let smtpHost: String?
    let smtpPort: Int?
    let smtpSecure: Bool?
    let requiresAppPassword: Bool
    let appPasswordHelpUrl: String?
}

extension MailProvider {
    /// Hand-maintained mirror of `contracts/mail-providers.json`, same
    /// convention as `DesignTokens.swift` for `design-tokens.json` — used
    /// by `MockAPIClient` (no bundled copy of the JSON contract file today)
    /// and as `OnboardingAccountConnectView`'s fallback if `GET
    /// /mail-providers` fails against a real backend. If
    /// `contracts/mail-providers.json` changes, update this to match and
    /// note it in `SYNC.md` under "Contract-Änderungen".
    static let mocked: [MailProvider] = [
        MailProvider(id: "gmail", label: "Gmail", authType: .oauth, comingSoon: false, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil),
        MailProvider(id: "outlook", label: "Outlook / Microsoft 365", authType: .oauth, comingSoon: true, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil),
        MailProvider(id: "yahoo", label: "Yahoo", authType: .oauth, comingSoon: true, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil),
        MailProvider(id: "icloud", label: "iCloud Mail", authType: .imap, comingSoon: false, imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://support.apple.com/en-us/102654"),
        MailProvider(id: "gmx", label: "GMX", authType: .imap, comingSoon: false, imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://hilfe.gmx.net"),
        MailProvider(id: "web_de", label: "web.de", authType: .imap, comingSoon: false, imapHost: "imap.web.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.web.de", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://hilfe.web.de"),
        MailProvider(id: "other_imap", label: "Anderer Anbieter (IMAP)", authType: .imap, comingSoon: false, imapHost: nil, imapPort: 993, imapSecure: true, smtpHost: nil, smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: nil),
    ]
}
