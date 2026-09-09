import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Runs the on-device-AI capability check shown during onboarding and
/// reported back via POST /capability-check (contracts/api-spec.yaml),
/// persisted server-side in db-schema.sql `user_ai_capability`.
///
/// STUB: the "supported" heuristic below is a placeholder (OS version +
/// a small device-model allowlist). A real check would probe for the
/// actual on-device model runtime (e.g. required OS/Neural Engine
/// availability) instead of guessing from device identifiers.
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

    /// Placeholder allowlist: treat any iPhone/iPad hardware identifier
    /// (e.g. "iPhone18,1", real device or simulated) as "supported", so the
    /// demo can show both branches of the UI without needing real
    /// device-capability data.
    private static func isLikelySupported(deviceModel: String, osVersion: String) -> Bool {
        deviceModel.hasPrefix("iPhone") || deviceModel.hasPrefix("iPad")
    }
}
