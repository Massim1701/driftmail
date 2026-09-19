import LocalAuthentication

/// Face ID/Touch ID app lock (WEB_INBOX.md 15.09., "App-Sperre per Face
/// ID/Touch ID"). Purely device-local -- this gates access to the
/// already-logged-in app UI so a lost/stolen, still-unlocked phone can't
/// have driftmail opened straight up; it does NOT replace the mail-account
/// login itself, and nothing here touches the backend (biometric
/// enrollment is inherently per-device, unlike the account-level MFA
/// settings already in contracts/db-schema.sql `user_security_settings`).
enum BiometricLock {
    enum Kind {
        case faceID
        case touchID
        /// Kein biometrischer Sensor eingerichtet/verfuegbar, aber ein
        /// Geraetecode ist gesetzt -- App-Sperre bleibt trotzdem moeglich
        /// (siehe Design-Entscheidung unten), nur ohne Face-/Touch-ID.
        case passcodeOnly
        /// Weder Biometrie noch ein Geraetecode eingerichtet -- App-Sperre
        /// kann in diesem Zustand nicht angeboten werden (LocalAuthentication
        /// hat dann grundsaetzlich nichts, gegen das es pruefen koennte).
        case unavailable

        var label: String {
            switch self {
            case .faceID: return "Face ID"
            case .touchID: return "Touch ID"
            case .passcodeOnly: return "Gerätecode"
            case .unavailable: return "nicht verfügbar"
            }
        }

        var systemImageName: String {
            switch self {
            case .faceID: return "faceid"
            case .touchID: return "touchid"
            case .passcodeOnly: return "lock.shield"
            case .unavailable: return "lock.slash"
            }
        }
    }

    /// Welche Sperr-Methode dieses Geraet aktuell anbietet -- steuert Icon/
    /// Beschriftung in der UI (Settings-Toggle, Onboarding-Schritt,
    /// Sperrbildschirm), ohne "Face ID" fest zu verdrahten.
    static func availableKind() -> Kind {
        let biometricContext = LAContext()
        if biometricContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) {
            switch biometricContext.biometryType {
            case .faceID: return .faceID
            case .touchID: return .touchID
            default: break
            }
        }
        let passcodeContext = LAContext()
        if passcodeContext.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
            return .passcodeOnly
        }
        return .unavailable
    }

    /// **Design-Entscheidung (19.09., nicht explizit im Auftrag):**
    /// `.deviceOwnerAuthentication` statt `.deviceOwnerAuthenticationWithBiometrics`
    /// -- fällt bei fehlgeschlagener/nicht eingerichteter Biometrie auf den
    /// Geräte-Code zurück, statt den User komplett auszusperren (z.B. wenn
    /// Face ID durch eine Maske/Verletzung gerade nicht funktioniert). Schützt
    /// trotzdem genau gegen den im Auftrag genannten Fall ("Gerät verloren/
    /// gestohlen, App noch eingeloggt"): wer weder das Gesicht/den Finger
    /// noch den Geräte-Code kennt, kommt so oder so nicht rein -- exakt
    /// dasselbe Schutzniveau wie der iOS-Sperrbildschirm selbst, zusätzlich
    /// auf driftmail angewendet.
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            return false
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }
}
