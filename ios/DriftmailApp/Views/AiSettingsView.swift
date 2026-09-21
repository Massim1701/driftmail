import SwiftUI

/// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
/// "ECHTE KI-ANBINDUNG" c3ec563): Einstellungs-UI für die eigene
/// Cloud-KI-Zugangsdaten des Users (BYOK -- Bring Your Own Key), siehe
/// backend/README.md "KI-Anbindung (BYOK)". Geräte-eigene KI (Apple
/// Foundation Models, siehe OnDeviceAiAdapter.swift) läuft immer zuerst und
/// braucht KEINE Einstellung hier -- dieser Screen betrifft ausschließlich
/// den optionalen Cloud-Fallback auf eigene Kosten.
///
/// Bewusst KEIN eigener Onboarding-Schritt (siehe backend/README.md,
/// Abschnitt "Onboarding-Zustimmungsschritt, bewusst NICHT als eigener
/// Onboarding-Screen gebaut") -- lebt hier in den Einstellungen, wo der
/// Consent überhaupt erst relevant wird.
struct AiSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    @State private var mode: AiPreferenceMode = .off
    @State private var provider: AiProvider = .anthropic
    @State private var apiKey: String = ""
    @State private var consentGiven: Bool = false

    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var savedConfirmation = false

    var body: some View {
        List {
            if isLoading {
                Section {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                }
            } else {
                Section {
                    Toggle("Cloud-KI (eigener Zugang)", isOn: cloudEnabledBinding)
                } footer: {
                    Text(onDeviceStatusText)
                }

                if mode == .byok {
                    Section {
                        Picker("Anbieter", selection: $provider) {
                            ForEach(AiProvider.implemented, id: \.self) { p in
                                Text(p.displayName).tag(p)
                            }
                        }

                        SecureField(
                            environment.aiSettings?.hasApiKey == true ? "Neuen Schlüssel eingeben (optional)" : "API-Schlüssel",
                            text: $apiKey
                        )
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        #if canImport(UIKit)
                        .textInputAutocapitalization(.never)
                        #endif

                        if environment.aiSettings?.hasApiKey == true {
                            Label("Ein Schlüssel ist hinterlegt", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(DesignTokens.Color.success)
                                .font(.system(size: DesignTokens.Typography.Size.small))
                        }
                    } header: {
                        Text("Eigener Zugang")
                    } footer: {
                        Text("Der Schlüssel wird verschlüsselt gespeichert und nie an dich zurückgegeben. Aktuell angebunden: Anthropic (Claude), OpenAI.")
                    }

                    Section {
                        Toggle("Zustimmung zur Cloud-Verarbeitung", isOn: $consentGiven)
                    } footer: {
                        Text("Ich stimme zu, dass Mail-Inhalte bei aktivierter Cloud-KI an den gewählten Anbieter gesendet werden, auf meine eigenen Kosten. Ohne diese Zustimmung nutzt driftmail weiterhin nur Geräte-eigene KI bzw. eine regelbasierte Heuristik.")
                    }
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Speichern")
                        }
                    }
                    .disabled(isSaving || (mode == .byok && apiKey.isEmpty && environment.aiSettings?.hasApiKey != true))

                    if savedConfirmation {
                        Label("Gespeichert", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(DesignTokens.Color.success)
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(DesignTokens.Color.dangerText)
                    }
                }
            }
        }
        .navigationTitle("KI-Anbindung")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    /// Der Toggle steuert nur `mode` lokal -- das eigentliche Ausschalten
    /// (inkl. Zurücksetzen von Provider/Key/Consent) passiert erst beim
    /// Tippen auf "Speichern" (`PUT /ai-settings` mit `mode=off`), analog
    /// zu Web/Backend: kein optimistisches Zurücksetzen ohne Bestätigung.
    private var cloudEnabledBinding: Binding<Bool> {
        Binding(
            get: { mode == .byok },
            set: { mode = $0 ? .byok : .off }
        )
    }

    /// [2026-09-21] Ehrlicher Status-Hinweis: Geräte-eigene KI ist die
    /// primäre Quelle, unabhängig von dieser Einstellung -- siehe
    /// OnDeviceModelAvailability in OnDeviceAiAdapter.swift.
    private var onDeviceStatusText: String {
        let base = OnDeviceModelAvailability.isAvailable
            ? "Geräte-eigene KI (Apple Intelligence) ist auf diesem Gerät verfügbar und wird immer zuerst versucht."
            : "Geräte-eigene KI ist auf diesem Gerät aktuell nicht verfügbar (\(OnDeviceModelAvailability.statusDescription)) -- driftmail nutzt stattdessen eine lokale, regelbasierte Zusammenfassung, solange kein eigener Cloud-Zugang aktiviert ist."
        return base
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        await environment.loadAiSettings()
        guard let settings = environment.aiSettings else { return }
        mode = settings.mode
        provider = settings.byokProvider ?? .anthropic
        consentGiven = settings.cloudConsentGiven
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        savedConfirmation = false
        defer { isSaving = false }
        do {
            _ = try await environment.updateAiSettings(
                mode: mode,
                byokProvider: mode == .byok ? provider : nil,
                apiKey: apiKey.isEmpty ? nil : apiKey,
                cloudConsent: mode == .byok ? consentGiven : nil
            )
            apiKey = ""
            savedConfirmation = true
        } catch APIError.badRequest(let message) {
            errorMessage = message ?? "Ungültige Einstellung."
        } catch {
            errorMessage = "Speichern fehlgeschlagen. Bitte später erneut versuchen."
        }
    }
}

#Preview {
    NavigationStack {
        AiSettingsView()
    }
    .environmentObject(AppEnvironment(previewClient: MockAPIClient()))
}
