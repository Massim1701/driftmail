import SwiftUI

/// Sperrt den kompletten App-Inhalt hinter Face ID/Touch ID/Geräte-Code,
/// solange `appLockEnabled` an ist (WEB_INBOX.md 15.09., "App-Sperre").
/// Re-sperrt bei jedem Wechsel aus dem Vordergrund (App-Wechsler-Vorschau,
/// Sperrbildschirm) -- genau der Moment, den dieses Feature schützen soll.
/// "Session" heißt hier: seit dem letzten Zurückkehren in den Vordergrund,
/// nicht pro Navigation innerhalb der App.
struct AppLockGateView<Content: View>: View {
    @AppStorage("appLockEnabled") private var isEnabled = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var isUnlocked = false
    @State private var isAuthenticating = false

    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            if isEnabled && !isUnlocked {
                lockScreen
            } else {
                content()
            }
        }
        .task {
            if isEnabled && !isUnlocked {
                await attemptUnlock()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                if isEnabled && !isUnlocked {
                    Task { await attemptUnlock() }
                }
            } else if isEnabled && newPhase == .background {
                // NUR bei .background erneut sperren, nicht bei .inactive --
                // .inactive feuert auch fuer rein interne Uebergaenge, bei
                // denen die App fuer den User sichtbar im Vordergrund
                // bleibt (Sheet-Praesentation wie ComposeView, der
                // Face-ID-System-Prompt selbst, Kontrollzentrum-Wisch...).
                // Mit ".inactive ODER .background" (vorheriger Code) sperrte
                // sich die App dadurch quasi bei jeder Interaktion neu und
                // fragte Face ID ständig erneut ab, statt nur einmal pro
                // echtem Verlassen der App -- genau der gemeldete Bug.
                isUnlocked = false
            }
        }
    }

    private var lockScreen: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            Spacer()

            Image(systemName: BiometricLock.availableKind().systemImageName)
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.Color.accent)

            Text("driftmail ist gesperrt")
                .font(.system(size: DesignTokens.Typography.Size.heading, weight: .medium))

            Spacer()

            Button {
                Task { await attemptUnlock() }
            } label: {
                Text("Entsperren")
                    .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignTokens.Spacing.md)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.Color.accent)
            .padding(.horizontal, DesignTokens.Spacing.xl)
            .disabled(isAuthenticating)
            .opacity(isAuthenticating ? 0.4 : 1.0)
        }
        .padding(.bottom, DesignTokens.Spacing.xl)
        .background(DesignTokens.Color.surfacePage)
    }

    private func attemptUnlock() async {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        isUnlocked = await BiometricLock.authenticate(reason: "Entsperre driftmail, um deine Mails zu sehen.")
    }
}

/// Wiederverwendbarer An/Aus-Schalter für die App-Sperre -- identisch im
/// Onboarding-Empfehlungsschritt (RootView) und im Settings-Sheet
/// (FolderListView) verwendet, damit beide garantiert denselben Zustand
/// zeigen (beide lesen/schreiben denselben `@AppStorage`-Key).
struct AppLockToggleView: View {
    @AppStorage("appLockEnabled") private var isEnabled = false
    let kind: BiometricLock.Kind

    var body: some View {
        if kind == .unavailable {
            Text("App-Sperre ist auf diesem Gerät nicht verfügbar (kein Geräte-Code eingerichtet).")
                .font(.system(size: DesignTokens.Typography.Size.small))
                .foregroundStyle(DesignTokens.Color.textSecondary)
        } else {
            Toggle(isOn: $isEnabled) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                    Text("App-Sperre (\(kind.label))")
                        .font(.system(size: DesignTokens.Typography.Size.bodyLarge))
                    Text("Zusätzlich zum Mail-Konto-Login: sperrt die App selbst, sobald sie im Hintergrund war.")
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }
            }
            .tint(DesignTokens.Color.accent)
        }
    }
}

#Preview {
    AppLockGateView {
        Text("Inhalt")
    }
}
