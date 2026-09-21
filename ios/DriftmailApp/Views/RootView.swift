import SwiftUI

/// Top-level flow: onboarding (capability check, dann App-Sperre-Empfehlung,
/// WEB_INBOX.md 15.09.) einmalig, danach der Ordner-Baum -- hinter
/// `AppLockGateView`, damit eine spätere Aktivierung der App-Sperre (über
/// das Settings-Sheet in `FolderListView`) sofort greift, nicht erst nach
/// einem Neustart.
/// `hasCompletedOnboarding` persists locally (UserDefaults) so the check
/// only re-runs if the user explicitly retriggers it from Settings — there
/// is no Settings screen yet in this scaffold, so for now it's one-and-done
/// per app install.
struct RootView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var onboardingStep: OnboardingStep = .capabilityCheck

    private enum OnboardingStep {
        case capabilityCheck
        case appLockRecommendation
    }

    var body: some View {
        // [2026-09-21] WEB_INBOX.md 19.09. "Onboarding: Provider-
        // Auswahlbildschirm" ("voll verdrahten"): Konto-Verbindung ist ein
        // eigenes, VORGESCHALTETES Gate -- unabhängig von
        // `hasCompletedOnboarding` (Capability-Check/App-Sperre-Empfehlung),
        // die weiterhin nur einmal pro Installation laufen. Ohne verbundenes
        // Konto gibt es noch nichts, worüber die restliche Onboarding-
        // Sequenz sinnvoll reden könnte.
        if !environment.isAuthenticated {
            OnboardingAccountConnectView { account, token in
                environment.completeAccountConnection(account: account, token: token)
            }
        } else if hasCompletedOnboarding {
            AppLockGateView {
                FolderListView()
            }
        } else {
            switch onboardingStep {
            case .capabilityCheck:
                OnboardingCapabilityCheckView {
                    onboardingStep = .appLockRecommendation
                }
            case .appLockRecommendation:
                OnboardingAppLockStepView {
                    hasCompletedOnboarding = true
                }
            }
        }
    }
}

/// Zweiter Onboarding-Schritt (WEB_INBOX.md 15.09.: App-Sperre "deutlich
/// empfohlen beim Onboarding", aber "nicht erzwungen, User-Entscheidung").
/// Bewusst hier co-located statt als eigene Datei/pbxproj-Eintrag -- wird
/// nur von RootView aus verwendet, gleiches Prinzip wie die private
/// `FolderRow` in FolderListView.swift.
private struct OnboardingAppLockStepView: View {
    let onContinue: () -> Void
    private let kind = BiometricLock.availableKind()

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            Spacer()

            Image(systemName: kind.systemImageName)
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.Color.accent)

            Text("App-Sperre aktivieren?")
                .font(.system(size: DesignTokens.Typography.Size.heading, weight: .medium))

            Text(kind == .unavailable
                 ? "Auf diesem Gerät ist kein Geräte-Code eingerichtet — App-Sperre ist deshalb nicht verfügbar."
                 : "Schützt deinen lokalen Mail-Cache zusätzlich zum Mail-Konto-Login, falls dein Gerät verloren geht oder gestohlen wird. Jederzeit in den Einstellungen änderbar.")
                .font(.system(size: DesignTokens.Typography.Size.body))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DesignTokens.Spacing.xl)

            if kind != .unavailable {
                AppLockToggleView(kind: kind)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
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
        }
        .padding(.bottom, DesignTokens.Spacing.xl)
        .background(DesignTokens.Color.surfacePage)
    }
}

#Preview {
    RootView()
        .environmentObject(AppEnvironment())
}
