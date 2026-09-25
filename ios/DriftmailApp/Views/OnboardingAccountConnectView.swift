import SwiftUI

/// Erster Onboarding-Schritt (WEB_INBOX.md 19.09. "Onboarding: Provider-
/// Auswahlbildschirm", "voll verdrahten" per Rückfrage an Massimo, 21.09.):
/// Provider-Auswahl (`GET /mail-providers`) + IMAP-Verbindungsformular
/// (`POST /accounts` `provider=imap`). Läuft VOR allem anderen in
/// `RootView` (auch vor der Capability-Check-Onboarding-Sequenz) -- ohne
/// verbundenes Konto gibt es noch nichts zu zeigen.
///
/// Nutzt bewusst einen EIGENEN, unauthentifizierten `RemoteAPIClient`
/// (`connectClient`), nicht `environment.apiClient` -- der ist an dieser
/// Stelle noch `MockAPIClient` (siehe `AppEnvironment.init()`), aber
/// Provider-Liste + Kontoverbindung müssen echte Netzwerk-Calls sein, das
/// ist der ganze Sinn dieses Schritts. Bei Erfolg übergibt
/// `onConnected(account, token)` an `RootView`, das wiederum
/// `environment.completeAccountConnection(...)` aufruft und damit
/// `environment.apiClient` für den Rest der App auf einen echten,
/// token-tragenden `RemoteAPIClient` umstellt.
///
/// [2026-09-25] WEB_INBOX.md 21.09. "Anbieter automatisch aus E-Mail-
/// Adresse erkennen": der bisherige erste Schritt (Anbieter-Liste VOR der
/// Adresseingabe) ist jetzt der SEKUNDÄRE, manuelle Weg
/// (`.pickProviderManually`, über einen Link erreichbar). Der neue erste
/// Schritt fragt nur die E-Mail-Adresse; die Endung wird gegen
/// `MailProvider.domains` (aus `GET /mail-providers`) gematcht, um direkt
/// zum passenden Formular zu springen -- kein unnötiger Extra-Klick für
/// den Normalfall.
struct OnboardingAccountConnectView: View {
    /// [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): `.login`
    /// ist der bisherige Erst-Onboarding-Schritt (kein Zurück möglich, es
    /// gibt noch nichts, wohin), `.addAccount` wird als Sheet aus
    /// `FolderListView`s Settings heraus präsentiert (Übergabe von Track A)
    /// -- mit Abbrechen-Möglichkeit statt Vollbild-Gate.
    enum Mode {
        case login
        case addAccount
    }

    var mode: Mode = .login
    let onConnected: (MailAccount, String) -> Void

    @Environment(\.dismiss) private var dismiss

    private enum Step {
        case enterEmail
        case pickProviderManually
        case imapForm(MailProvider, initialEmail: String)
    }

    @State private var step: Step = .enterEmail
    @State private var email = ""
    @State private var providers: [MailProvider] = MailProvider.mocked
    @State private var providersLoadFailed = false
    /// [2026-09-25] Statt nur des Labels wird jetzt der ganze Provider
    /// gemerkt: faellt der User nach der "nicht verfuegbar"-Erklaerung auf
    /// IMAP zurueck (`proceedWithFallbackImap()`), sollen bereits bekannte
    /// IMAP/SMTP-Einstellungen des erkannten Anbieters (z.B. Gmail) das
    /// Formular vorbefuellen, statt immer im komplett leeren generischen
    /// Formular zu landen.
    @State private var unavailableProvider: MailProvider?

    private let connectClient = RemoteAPIClient()

    var body: some View {
        switch step {
        case .enterEmail:
            emailEntry
        case .pickProviderManually:
            providerPicker
        case .imapForm(let provider, let initialEmail):
            ImapConnectFormView(
                provider: provider,
                initialEmail: initialEmail,
                client: connectClient,
                onBack: { step = .enterEmail },
                onConnected: onConnected
            )
        }
    }

    private var emailEntry: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            if mode == .addAccount {
                HStack {
                    Button("Abbrechen") { dismiss() }
                        .font(.system(size: DesignTokens.Typography.Size.body))
                    Spacer()
                }
                .padding(.horizontal, DesignTokens.Spacing.xl)
                .padding(.top, DesignTokens.Spacing.lg)
            } else {
                Spacer()
            }

            Image(systemName: "envelope.badge.shield.half.filled")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.Color.accent)

            VStack(spacing: DesignTokens.Spacing.xs) {
                Text("driftmail")
                    .font(.system(size: DesignTokens.Typography.Size.heading, weight: .medium))
                Text(mode == .addAccount ? "Welches weitere Konto möchtest du verbinden?" : "Wähle dein E-Mail-Konto, um loszulegen.")
                    .font(.system(size: DesignTokens.Typography.Size.body))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }

            if providersLoadFailed {
                Text("Anbieterliste konnte nicht live geladen werden — Erkennung nutzt die zuletzt bekannten Anbieter.")
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
            }

            VStack(spacing: DesignTokens.Spacing.sm) {
                TextField("E-Mail-Adresse", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { continueFromEmail() }

                Button {
                    continueFromEmail()
                } label: {
                    Text("Weiter")
                        .frame(maxWidth: .infinity)
                        .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.Color.accent)
                .disabled(!email.contains("@"))

                Button("Anbieter manuell auswählen") { step = .pickProviderManually }
                    .font(.system(size: DesignTokens.Typography.Size.small))
            }
            .padding(.horizontal, DesignTokens.Spacing.xl)

            Spacer()
            Spacer()
        }
        .background(DesignTokens.Color.surfacePage)
        .task { await loadProviders() }
        .alert(unavailableProvider.map { "\($0.label) auf iOS noch nicht verfügbar" } ?? "", isPresented: Binding(
            get: { unavailableProvider != nil },
            set: { if !$0 { unavailableProvider = nil } }
        )) {
            Button("Trotzdem per IMAP versuchen") { proceedWithFallbackImap() }
            Button("Verstanden", role: .cancel) {}
        } message: {
            Text("Der Login läuft über einen Browser-Redirect, dessen Rücksprungziel serverseitig aktuell fest auf den Web-Client zeigt (siehe SYNC.md, Offene Frage an Track A). Du kannst es trotzdem über den generischen IMAP-Weg versuchen, falls dein Anbieter das zulässt, oder ein anderes Konto verwenden.")
        }
    }

    /// Domain-Matching der eingegebenen Adresse gegen `MailProvider.domains`
    /// (case-insensitive, exakter Domain-Vergleich nach dem "@" -- kein
    /// Suffix-/Teilstring-Match, um z.B. "not-gmail.com" nicht faelschlich
    /// auf Gmail zu matchen).
    private func matchedProvider(for email: String) -> MailProvider? {
        guard let at = email.lastIndex(of: "@") else { return nil }
        let domain = email[email.index(after: at)...].lowercased().trimmingCharacters(in: .whitespaces)
        guard !domain.isEmpty else { return nil }
        return providers.first { $0.domains.contains(domain) }
    }

    private var fallbackImapProvider: MailProvider {
        providers.first { $0.id == "other_imap" }
            ?? providers.first { $0.authType == .imap && $0.imapHost == nil }
            ?? MailProvider.mocked.first { $0.id == "other_imap" }!
    }

    private func continueFromEmail() {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("@") else { return }

        guard let match = matchedProvider(for: trimmed) else {
            // Unbekannte Endung: sauberer Fallback auf generisches IMAP,
            // kein Fehler, keine Sackgasse (WEB_INBOX.md 21.09. Punkt 3).
            step = .imapForm(fallbackImapProvider, initialEmail: trimmed)
            return
        }
        if match.authType == .oauth || match.comingSoon {
            // Gmail ist auf iOS erkannt, aber ungefixt nicht funktional
            // (siehe bestehende Grenze weiter unten); Outlook/Yahoo sind
            // serverseitig noch gar nicht angebunden (comingSoon). Beides
            // wird hier gleich behandelt: erklären + Fallback anbieten,
            // statt den User ins Leere laufen zu lassen.
            unavailableProvider = match
            return
        }
        step = .imapForm(match, initialEmail: trimmed)
    }

    /// [2026-09-25] "passe die App auf googlemail.com an": Gmail hat (siehe
    /// `MailProvider.mocked`/`contracts/mail-providers.json`) inzwischen
    /// ein echtes IMAP-Preset (imap.gmail.com, App-Passwort-Hinweis),
    /// obwohl `authType == .oauth` bleibt (der Web-Client nutzt weiterhin
    /// den echten Google-Login) -- auf iOS, wo OAuth nicht funktioniert,
    /// wird dieses Preset jetzt als Vorbefuellung genutzt, statt immer im
    /// leeren generischen Formular zu landen. Andere aktuell unverfuegbare
    /// Treffer ohne eigenes IMAP-Preset (Outlook/Yahoo, `imapHost == nil`)
    /// fallen weiterhin auf das komplett generische Formular zurueck.
    private func proceedWithFallbackImap() {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        let provider = unavailableProvider?.imapHost != nil ? unavailableProvider! : fallbackImapProvider
        unavailableProvider = nil
        step = .imapForm(provider, initialEmail: trimmed)
    }

    /// Manueller Fallback/Override (z.B. um ein Preset unabhängig von der
    /// eingegebenen Adresse zu testen, oder eine falsche Erkennung zu
    /// korrigieren) -- bewusst nicht entfernt, nur zum sekundären Weg
    /// gemacht, damit die bestehende, funktionierende Auswahl erhalten
    /// bleibt.
    private var providerPicker: some View {
        VStack(spacing: DesignTokens.Spacing.xl) {
            HStack {
                Button(action: { step = .enterEmail }) {
                    Label("Zurück", systemImage: "chevron.left")
                        .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                }
                Spacer()
            }
            .padding(.horizontal, DesignTokens.Spacing.xl)
            .padding(.top, DesignTokens.Spacing.lg)

            VStack(spacing: DesignTokens.Spacing.xs) {
                Text("Anbieter manuell auswählen")
                    .font(.system(size: DesignTokens.Typography.Size.heading, weight: .medium))
            }

            VStack(spacing: DesignTokens.Spacing.sm) {
                ForEach(providers) { provider in
                    ProviderRow(provider: provider) { select(provider) }
                }
            }
            .padding(.horizontal, DesignTokens.Spacing.xl)

            Spacer()
            Spacer()
        }
        .background(DesignTokens.Color.surfacePage)
    }

    private func select(_ provider: MailProvider) {
        guard !provider.comingSoon else { return }
        if provider.authType == .oauth {
            unavailableProvider = provider
            return
        }
        step = .imapForm(provider, initialEmail: email.trimmingCharacters(in: .whitespaces))
    }

    private func loadProviders() async {
        do {
            providers = try await connectClient.fetchMailProviders()
        } catch {
            // Fallback-Liste (MailProvider.mocked, siehe State-Default oben)
            // bleibt stehen, damit der Onboarding-Flow nicht komplett
            // blockiert, wenn das Backend gerade nicht erreichbar ist --
            // gleiches Prinzip wie web/src/components/OnboardingScreen.tsx.
            providersLoadFailed = true
        }
    }
}

private struct ProviderRow: View {
    let provider: MailProvider
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.label)
                        .font(.system(size: DesignTokens.Typography.Size.body, weight: .medium))
                        .foregroundStyle(provider.comingSoon ? DesignTokens.Color.textMuted : DesignTokens.Color.textPrimary)
                    Text(provider.comingSoon ? "demnächst" : provider.authType == .oauth ? "Anmelden" : provider.authType == .pop3 ? "POP3 verbinden" : "IMAP verbinden")
                        .font(.system(size: DesignTokens.Typography.Size.caption))
                        .foregroundStyle(DesignTokens.Color.textMuted)
                }
                Spacer()
                if !provider.comingSoon {
                    Image(systemName: "chevron.right")
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.textMuted)
                }
            }
            .padding(DesignTokens.Spacing.md)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.control)
                    .fill(DesignTokens.Color.surfaceCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.control)
                            .stroke(DesignTokens.Color.border, lineWidth: 1)
                    )
            )
        }
        .disabled(provider.comingSoon)
        .opacity(provider.comingSoon ? 0.55 : 1)
    }
}

/// IMAP-Verbindungsformular, vorbefüllt aus dem gewählten `MailProvider`-
/// Preset. Servereinstellungen (Host/Port/TLS/SMTP) sind standardmäßig
/// eingeklappt (Normalfall braucht nur E-Mail + Passwort), außer beim
/// generischen IMAP-Provider (`imapHost == nil`), wo sie sofort nötig sind.
private struct ImapConnectFormView: View {
    /// [2026-09-22] "web.de ist POP3": manche Provider/Nutzer bevorzugen
    /// POP3 statt IMAP (oder haben bei ihrem Provider nur POP3 aktiviert).
    /// Eigener kleiner Enum statt `MailAccount.Provider` wiederzuverwenden
    /// -- hier geht es um das Verbindungsprotokoll fuer DIESES Formular,
    /// nicht um den gespeicherten Konto-Provider-Typ (beide haben zufaellig
    /// dieselben zwei Werte, sind aber unterschiedliche Konzepte).
    private enum ConnectionProtocol: String, CaseIterable, Identifiable {
        case imap = "IMAP"
        case pop3 = "POP3"
        var id: String { rawValue }
        var defaultPort: Int { self == .imap ? 993 : 995 }
    }

    let provider: MailProvider
    let client: RemoteAPIClient
    let onBack: () -> Void
    let onConnected: (MailAccount, String) -> Void

    @State private var emailAddress: String
    @State private var password = ""
    @State private var showAdvanced: Bool
    @State private var connectionProtocol: ConnectionProtocol = .imap
    @State private var imapHost: String
    @State private var imapPort: String
    @State private var imapSecure: Bool
    @State private var imapUser = ""
    @State private var smtpHost: String
    @State private var smtpPort: String
    @State private var smtpSecure: Bool
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    /// `initialEmail`: die auf dem vorigen Schritt (`enterEmail`) bereits
    /// eingegebene Adresse -- WEB_INBOX.md 21.09. "kein unnötiger
    /// Extra-Schritt" heißt auch: nicht nochmal von vorn tippen lassen.
    init(provider: MailProvider, initialEmail: String = "", client: RemoteAPIClient, onBack: @escaping () -> Void, onConnected: @escaping (MailAccount, String) -> Void) {
        self.provider = provider
        self.client = client
        self.onBack = onBack
        self.onConnected = onConnected
        _emailAddress = State(initialValue: initialEmail)
        _showAdvanced = State(initialValue: provider.imapHost == nil)
        _connectionProtocol = State(initialValue: provider.authType == .pop3 ? .pop3 : .imap)
        _imapHost = State(initialValue: provider.imapHost ?? "")
        _imapPort = State(initialValue: String(provider.imapPort ?? 993))
        _imapSecure = State(initialValue: provider.imapSecure ?? true)
        _smtpHost = State(initialValue: provider.smtpHost ?? "")
        _smtpPort = State(initialValue: String(provider.smtpPort ?? 587))
        _smtpSecure = State(initialValue: provider.smtpSecure ?? false)
    }

    var body: some View {
        Form {
            Section {
                Button(action: onBack) {
                    Label("Anderer Anbieter", systemImage: "chevron.left")
                        .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            if provider.requiresAppPassword {
                Section {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                        Text("\(provider.label) verlangt ein App-spezifisches Passwort statt deines normalen Kontopassworts.")
                            .font(.system(size: DesignTokens.Typography.Size.small))
                        if let helpUrl = provider.appPasswordHelpUrl, let url = URL(string: helpUrl) {
                            Link("Anleitung für \(provider.label)", destination: url)
                                .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                        }
                    }
                }
            }

            Section("Zugangsdaten") {
                TextField("E-Mail-Adresse", text: $emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(provider.requiresAppPassword ? "App-Passwort" : "Passwort", text: $password)
            }

            // [2026-09-22] Massimo: "die App muss erkennen ob POP oder IMAP,
            // das sind ja keine Geheimnisse, nur bei unbekannten
            // Mailservern abfragen welcher Dienst -- zu viele Fragen
            // koennen User verwirren". Bei einem BEKANNTEN Preset (web.de,
            // GMX, iCloud -- `provider.imapHost != nil`) steht das
            // Protokoll schon fest (funktioniert bereits zuverlaessig ueber
            // IMAP, echt verifiziert) -- keine zusaetzliche Frage. Nur beim
            // generischen "Anderer Anbieter" (`imapHost == nil`, wirklich
            // unbekannter Server) zeigen wir die Wahl ueberhaupt.
            if provider.imapHost == nil {
                Section {
                    Picker("Protokoll", selection: $connectionProtocol) {
                        ForEach(ConnectionProtocol.allCases) { p in
                            Text(p.rawValue).tag(p)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: connectionProtocol) { oldValue, newValue in
                        // Host-Praefix + Standard-Port automatisch mitziehen,
                        // z.B. "imap.provider.de"/993 -> "pop3.provider.de"/995
                        // -- nur wenn Host/Port noch auf dem jeweiligen
                        // Standard stehen (kein Ueberschreiben eigener
                        // manueller Werte).
                        if imapHost.hasPrefix("\(oldValue.rawValue.lowercased()).") {
                            imapHost = "\(newValue.rawValue.lowercased())." + imapHost.dropFirst(oldValue.rawValue.count + 1)
                        }
                        if Int(imapPort) == oldValue.defaultPort {
                            imapPort = String(newValue.defaultPort)
                        }
                    }
                } footer: {
                    Text("Falls du nicht sicher bist: dein Anbieter nennt das meist \"IMAP\" oder \"POP3\" in seinen Einstellungen.")
                        .font(.system(size: DesignTokens.Typography.Size.small))
                }
            }

            Section {
                DisclosureGroup("Servereinstellungen", isExpanded: $showAdvanced) {
                    TextField("\(connectionProtocol.rawValue)-Server", text: $imapHost)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("\(connectionProtocol.rawValue)-Port", text: $imapPort)
                        .keyboardType(.numberPad)
                    Toggle("\(connectionProtocol.rawValue) TLS", isOn: $imapSecure)
                    TextField("Nutzername (optional, falls abweichend)", text: $imapUser)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("SMTP-Server (optional)", text: $smtpHost)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("SMTP-Port", text: $smtpPort)
                        .keyboardType(.numberPad)
                    Toggle("SMTP TLS", isOn: $smtpSecure)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.dangerText)
                }
            }

            Section {
                Button {
                    Task { await submit() }
                } label: {
                    Text(isSubmitting ? "Verbinde…" : "Verbinden")
                        .frame(maxWidth: .infinity)
                        .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.Color.accent)
                .disabled(isSubmitting || emailAddress.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || imapHost.trimmingCharacters(in: .whitespaces).isEmpty)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle(provider.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let account: MailAccount
            let token: String
            switch connectionProtocol {
            case .imap:
                (account, token) = try await client.connectImapAccount(
                    emailAddress: emailAddress.trimmingCharacters(in: .whitespaces),
                    imapHost: imapHost.trimmingCharacters(in: .whitespaces),
                    imapPort: Int(imapPort) ?? 993,
                    imapSecure: imapSecure,
                    imapUser: imapUser.trimmingCharacters(in: .whitespaces).isEmpty ? nil : imapUser,
                    imapPassword: password,
                    smtpHost: smtpHost.trimmingCharacters(in: .whitespaces).isEmpty ? nil : smtpHost,
                    smtpPort: Int(smtpPort),
                    smtpSecure: smtpSecure
                )
            case .pop3:
                (account, token) = try await client.connectPop3Account(
                    emailAddress: emailAddress.trimmingCharacters(in: .whitespaces),
                    pop3Host: imapHost.trimmingCharacters(in: .whitespaces),
                    pop3Port: Int(imapPort) ?? 995,
                    pop3Secure: imapSecure,
                    pop3User: imapUser.trimmingCharacters(in: .whitespaces).isEmpty ? nil : imapUser,
                    pop3Password: password,
                    smtpHost: smtpHost.trimmingCharacters(in: .whitespaces).isEmpty ? nil : smtpHost,
                    smtpPort: Int(smtpPort),
                    smtpSecure: smtpSecure
                )
            }
            onConnected(account, token)
        } catch APIError.verificationFailed {
            errorMessage = "Verbindung fehlgeschlagen. Bitte E-Mail-Adresse, App-Passwort und Servereinstellungen prüfen."
        } catch APIError.notAllowlisted {
            errorMessage = "Diese E-Mail-Adresse ist für driftmail (noch) nicht freigeschaltet."
        } catch {
            errorMessage = "Verbindung fehlgeschlagen. Bitte später erneut versuchen."
        }
    }
}

#Preview {
    OnboardingAccountConnectView(onConnected: { _, _ in })
}
