import SwiftUI

/// First-launch screen: runs `CapabilityChecker`, reports the result via
/// POST /capability-check (contracts/api-spec.yaml), and tells the user
/// whether on-device AI or cloud fallback will be used.
struct OnboardingCapabilityCheckView: View {
    @EnvironmentObject private var environment: AppEnvironment
    let onContinue: () -> Void

    private enum Phase {
        case checking
        case result(UserAiCapability)
        case failed
    }

    @State private var phase: Phase = .checking

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            Spacer()

            Image(systemName: "sparkles")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.Color.accent)

            Text("driftmail")
                .font(.system(size: DesignTokens.Typography.Size.heading, weight: .medium))

            switch phase {
            case .checking:
                ProgressView()
                Text("Prüfe Gerät auf On-Device-KI …")
                    .font(.system(size: DesignTokens.Typography.Size.body))
                    .foregroundStyle(DesignTokens.Color.textSecondary)

            case .result(let capability):
                VStack(spacing: DesignTokens.Spacing.md) {
                    Image(systemName: capability.onDeviceSupported ? "checkmark.circle.fill" : "icloud.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(capability.onDeviceSupported ? DesignTokens.Color.success : DesignTokens.Color.warning)

                    Text(capability.onDeviceSupported
                         ? "On-Device-KI verfügbar"
                         : "On-Device-KI nicht verfügbar")
                        .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))

                    Text(capability.onDeviceSupported
                         ? "Spam-Erkennung und Zusammenfassungen laufen direkt auf diesem Gerät (\(capability.deviceModel ?? "unbekannt")), ohne dass Inhalte das Gerät verlassen."
                         : "Dieses Gerät (\(capability.deviceModel ?? "unbekannt")) nutzt stattdessen den Cloud-Fallback für KI-Funktionen.")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, DesignTokens.Spacing.xl)
                }

            case .failed:
                Text("Prüfung fehlgeschlagen — Cloud-Fallback wird verwendet.")
                    .font(.system(size: DesignTokens.Typography.Size.body))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }

            Spacer()

            Button(action: onContinue) {
                Text("Weiter")
                    .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignTokens.Spacing.md)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.Color.accent)
            .padding(.horizontal, DesignTokens.Spacing.xl)
            .disabled(isChecking)
            .opacity(isChecking ? 0.4 : 1.0)
        }
        .padding(.bottom, DesignTokens.Spacing.xl)
        .background(DesignTokens.Color.surfacePage)
        .task {
            await runCheck()
        }
    }

    private var isChecking: Bool {
        if case .checking = phase { return true }
        return false
    }

    private func runCheck() async {
        let result = await CapabilityChecker.check()
        environment.capability = result
        do {
            try await environment.apiClient.reportCapabilityCheck(result)
        } catch {
            // Non-fatal: capability check result is still usable locally
            // even if reporting it to the backend fails.
        }
        phase = .result(result)
    }
}

#Preview {
    OnboardingCapabilityCheckView(onContinue: {})
        .environmentObject(AppEnvironment())
}
