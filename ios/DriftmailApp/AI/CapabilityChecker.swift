import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Runs the on-device-AI capability check shown during onboarding and
/// reported back via POST /capability-check (contracts/api-spec.yaml),
/// persisted server-side in db-schema.sql `user_ai_capability`.
///
/// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): `isLikelySupported`
/// ist kein Platzhalter mehr -- fragt `SystemLanguageModel.default.
/// isAvailable` (Apple Foundation Models, siehe `OnDeviceModelAvailability`
/// in OnDeviceAiAdapter.swift) real ab, statt anhand des Geraetemodell-
/// Strings zu raten. Faellt auf die alte Geraetemodell-Heuristik zurueck,
/// wenn das Ziel unter iOS 26 liegt (Foundation Models existiert dort
/// schlicht nicht) -- nicht mehr als grobe Approximation gedacht, sondern
/// als ehrlicher "kein Foundation-Models-SDK auf dieser OS-Version"-Fall.
enum CapabilityChecker {

    static func check() async -> UserAiCapability {
        // Simulate a short async probe (model load / capability query).
        try? await Task.sleep(nanoseconds: 400_000_000)

        let osVersion = currentOSVersionString()
        let deviceModel = currentDeviceModel()
        let onDeviceSupported = isLikelySupported(deviceModel: deviceModel, osVersion: osVersion)

        return UserAiCapability(
            platform: .ios,
            deviceModel: deviceModel,
            osVersion: osVersion,
            onDeviceSupported: onDeviceSupported,
            activeMode: onDeviceSupported ? .onDevice : .cloudFallback
        )
    }

    private static func currentOSVersionString() -> String {
        #if canImport(UIKit)
        let v = UIDevice.current.systemVersion
        return "iOS \(v)"
        #else
        return ProcessInfo.processInfo.operatingSystemVersionString
        #endif
    }

    private static func currentDeviceModel() -> String {
        // In the Simulator, `uname().machine` reports the host Mac's CPU
        // arch ("arm64"/"x86_64"), not a device identifier — Apple exposes
        // the *simulated* device's real identifier via this env var instead.
        if let simulatorModel = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulatorModel
        }
        #if canImport(UIKit)
        var systemInfo = utsname()
        uname(&systemInfo)
        let machineMirror = Mirror(reflecting: systemInfo.machine)
        let identifier = machineMirror.children.reduce(into: "") { result, element in
            guard let value = element.value as? Int8, value != 0 else { return }
            result += String(UnicodeScalar(UInt8(value)))
        }
        return identifier.isEmpty ? UIDevice.current.model : identifier
        #else
        return "unknown"
        #endif
    }

    /// Echte Verfuegbarkeitspruefung (siehe Datei-Kopfkommentar). Die
    /// Parameter (`deviceModel`/`osVersion`) werden nur noch fuer den
    /// Alt-Pfad unter iOS 26 gebraucht -- `OnDeviceModelAvailability`
    /// fragt das Geraet selbst, nicht diese Strings.
    private static func isLikelySupported(deviceModel: String, osVersion: String) -> Bool {
        if OnDeviceModelAvailability.isAvailable {
            return true
        }
        if #available(iOS 26.0, *) {
            // Framework existiert, aber SystemLanguageModel meldet
            // `.unavailable` (Geraet nicht geeignet/Apple Intelligence aus/
            // Modell noch nicht bereit) -- ehrlich `false`, kein Rate-Fallback.
            return false
        }
        // Alt-Geraet unter iOS 26: Foundation Models existiert im SDK-Ziel
        // gar nicht, bisherige grobe Geraetemodell-Heuristik als letzter
        // Anhaltspunkt, damit die Demo-UI auf sehr alten Simulatoren/
        // Geraeten weiterhin beide Zweige zeigen kann.
        return deviceModel.hasPrefix("iPhone") || deviceModel.hasPrefix("iPad")
    }
}
