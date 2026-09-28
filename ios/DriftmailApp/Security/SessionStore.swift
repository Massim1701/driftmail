import UIKit
import AuthenticationServices
import Foundation
import Security

/// Persists the backend session token in the Keychain (`kSecClassGenericPassword`),
/// not `UserDefaults`/`@AppStorage` — Keychain entries are at-rest encrypted
/// by the system, UserDefaults (a plist in the app container) is not. This
/// was flagged as the design decision to make "whenever this day comes" in
/// `RemoteAPIClient.swift`'s header comment and `ios/README.md`
/// ("Geprüft, nicht gebaut: Verschlüsselung der lokalen Mail-Datenbank") --
/// this is that day (WEB_INBOX.md 19.09. "Onboarding: Provider-
/// Auswahlbildschirm", "voll verdrahten" per Rückfrage an Massimo, 21.09.).
///
/// One token per app install (single-account, matching the rest of the
/// app/backend's "no multi-account" scope) — `service`+`account` below are
/// therefore fixed constants, not per-user keys.
enum SessionStore {
    private static let service = "online.driftware.driftmail2.session"
    private static let account = "session-token"

    static func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        // Delete first, then add — simpler and just as correct as
        // SecItemUpdate for a single-value item, avoids handling the
        // "exists vs. doesn't exist yet" branch twice.
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// [2026-09-28] Massimo: Gmail so einfach wie in Apple Mail -- Google-Fenster,
/// normales Passwort, fertig. Öffnet die Google-Anmeldung im System-Browser-
/// Fenster (`ASWebAuthenticationSession`, dasselbe Fenster, das auch andere
/// Apps nutzen; driftmail sieht das Passwort nie). Das Backend springt nach
/// der Anmeldung auf `driftmail://auth/callback?token=...&account=...`
/// zurück (siehe backend routes/auth.ts, `client=ios`). Das Schema muss
/// dafür NICHT in der Info.plist registriert sein -- die Session fängt den
/// Rücksprung selbst ab.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: Error {
        case cancelled
        case server(String)
    }

    private var session: ASWebAuthenticationSession?

    /// Liefert (Session-Token, Konto-ID) aus dem Rücksprung.
    func signIn(startURL: URL) async throws -> (token: String, accountId: String?) {
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: startURL, callbackURLScheme: "driftmail") { url, error in
                if let url {
                    continuation.resume(returning: url)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: Failure.cancelled)
                } else {
                    continuation.resume(throwing: error ?? Failure.cancelled)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let token = items.first(where: { $0.name == "token" })?.value {
            return (token, items.first(where: { $0.name == "account" })?.value)
        }
        throw Failure.server(items.first(where: { $0.name == "error" })?.value ?? "unknown")
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }
}
