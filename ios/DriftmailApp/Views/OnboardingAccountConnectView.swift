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
        case imapForm(MailProvider, initialEmail: String, initialUser: String = "")
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
    /// [2026-09-28] Automatische Erkennung für unbekannte Domains läuft.
    @State private var isDiscovering = false

    /// [2026-09-28] Beim Hinzufügen eines weiteren Kontos den gespeicherten
    /// Session-Token mitschicken -- ohne ihn legte der Server das neue Konto
    /// bei einem NEUEN, leeren User an statt beim angemeldeten.
    private var connectClient: RemoteAPIClient {
        RemoteAPIClient(token: mode == .addAccount ? SessionStore.loadToken() : nil)
    }
    @State private var googleSignIn = GoogleSignIn()
    @State private var isSigningInWithGoogle = false
    @State private var googleError: String?

    var body: some View {
        switch step {
        case .enterEmail:
            emailEntry
        case .pickProviderManually:
            providerPicker
        case .imapForm(let provider, let initialEmail, let initialUser):
            ImapConnectFormView(
                provider: provider,
                initialEmail: initialEmail,
                initialUser: initialUser,
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

            // [2026-09-28] Redesign "ruhig & warm": Logo + Serif-Wortmarke,
            // saisonaler Zweig, Leitsatz (wie die Web-Anmeldung).
            if mode != .addAccount {
                SeasonalTwigView()
                    .frame(width: 180)
            }

            VStack(spacing: DesignTokens.Spacing.sm) {
                HStack(spacing: DesignTokens.Spacing.sm) {
                    BrandMarkView().frame(width: 30, height: 30)
                    Text("driftmail")
                        .font(DesignTokens.Typography.display(26))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                }
                Text(mode == .addAccount ? "Welches weitere Konto möchtest du verbinden?" : "Deine Mails. Ruhig sortiert, gut geschützt.")
                    .font(DesignTokens.Typography.display(mode == .addAccount ? DesignTokens.Typography.Size.bodyLarge : 20, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
            }

            if mode != .addAccount {
                ProtectionTipView()
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
                    Text(isDiscovering ? "Suche Servereinstellungen…" : "Weiter")
                        .frame(maxWidth: .infinity)
                        .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.Color.accent)
                .disabled(!email.contains("@") || isDiscovering)

                if let googleError {
                    Text(googleError)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.dangerText)
                        .multilineTextAlignment(.center)
                }
                if isSigningInWithGoogle {
                    ProgressView("Warte auf Google…")
                        .font(.system(size: DesignTokens.Typography.Size.small))
                }

                Button("Anbieter manuell auswählen") { step = .pickProviderManually }
                    .font(.system(size: DesignTokens.Typography.Size.small))
            }
            .padding(.horizontal, DesignTokens.Spacing.xl)

            Spacer()
            Spacer()
        }
        .background(DesignTokens.Color.surfacePage)
        .task { await loadProviders() }
        .alert(unavailableProvider.map { "\($0.label) ist noch nicht verfügbar" } ?? "", isPresented: Binding(
            get: { unavailableProvider != nil },
            set: { if !$0 { unavailableProvider = nil } }
        )) {
            Button("Trotzdem per IMAP versuchen") { proceedWithFallbackImap() }
            Button("Verstanden", role: .cancel) {}
        } message: {
            Text(unavailableProvider?.setupHint ?? "Du kannst es trotzdem über den allgemeinen IMAP-Weg versuchen, falls dein Anbieter das zulässt, oder ein anderes Konto verwenden.")
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
            // [2026-09-28] Unbekannte Endung: erst automatisch erkennen
            // (GET /mail-providers/discover), sonst wie bisher ohne Fehler
            // ins generische Formular (WEB_INBOX.md 21.09. Punkt 3).
            Task { await discoverAndContinue(email: trimmed) }
            return
        }
        continueWith(match, email: trimmed)
    }

    /// [2026-09-28] Gmail (OAuth, aber mit IMAP-Presets) geht auf iOS direkt
    /// ins Formular mit App-Passwort -- die Google-Anmeldung kann hier nicht
    /// zurückspringen. Nur Anbieter ohne Passwort-Weg (Outlook) bekommen
    /// die Erklärung mit "Trotzdem per IMAP versuchen".
    private func continueWith(_ provider: MailProvider, email: String, user: String = "") {
        // [2026-09-28] Wie Apple Mail: ist die Google-Anmeldung auf dem
        // Server eingerichtet, direkt das Google-Fenster öffnen.
        if provider.authType == .oauth && provider.oauthAvailable && !provider.comingSoon {
            Task { await signInWithGoogle() }
            return
        }
        guard provider.usableWithPassword else {
            unavailableProvider = provider
            return
        }
        step = .imapForm(provider.asImapFallback, initialEmail: email, initialUser: user)
    }

    private func signInWithGoogle() async {
        isSigningInWithGoogle = true
        googleError = nil
        defer { isSigningInWithGoogle = false }
        do {
            let client = connectClient
            let startURL = mode == .addAccount ? try await client.googleLinkURL() : client.googleSignInStartURL
            let result = try await googleSignIn.signIn(startURL: startURL)
            let accounts = try await RemoteAPIClient(token: result.token).fetchAccounts()
            guard let account = accounts.first(where: { $0.id == result.accountId }) ?? accounts.first else {
                googleError = "Die Anmeldung hat geklappt, das Konto wurde aber nicht gefunden. Bitte erneut versuchen."
                return
            }
            onConnected(account, result.token)
        } catch GoogleSignIn.Failure.cancelled {
            // Fenster vom User geschlossen -- still zurück.
        } catch GoogleSignIn.Failure.server(let code) {
            googleError = code == "not_allowlisted"
                ? "Diese E-Mail-Adresse ist für driftmail (noch) nicht freigeschaltet."
                : "Die Anmeldung bei Google hat nicht geklappt (\(code)). Bitte erneut versuchen."
        } catch {
            googleError = "Google-Anmeldung konnte nicht gestartet werden. Ist der driftmail-Server erreichbar?"
        }
    }

    private func discoverAndContinue(email trimmed: String) async {
        guard let at = trimmed.lastIndex(of: "@") else { return }
        let localPart = String(trimmed[..<at])
        let domain = trimmed[trimmed.index(after: at)...].lowercased()
        isDiscovering = true
        defer { isDiscovering = false }
        guard let found = try? await connectClient.discoverMailSettings(domain: domain), found.found else {
            step = .imapForm(fallbackImapProvider, initialEmail: trimmed)
            return
        }
        if let id = found.providerId, let preset = providers.first(where: { $0.id == id }) {
            continueWith(preset, email: trimmed)
        } else if found.imapHost != nil {
            step = .imapForm(.discovered(domain: domain, settings: found), initialEmail: trimmed, initialUser: found.username == "localpart" ? localPart : "")
        } else {
            step = .imapForm(fallbackImapProvider, initialEmail: trimmed)
        }
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
        continueWith(provider, email: email.trimmingCharacters(in: .whitespaces))
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
                    Text(provider.comingSoon ? "demnächst" : provider.authType == .oauth ? (provider.oauthAvailable ? "Mit Google anmelden" : provider.imapHost != nil ? "Mit App-Passwort" : "Anmelden") : provider.authType == .pop3 ? "POP3 verbinden" : "IMAP verbinden")
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
    init(provider: MailProvider, initialEmail: String = "", initialUser: String = "", client: RemoteAPIClient, onBack: @escaping () -> Void, onConnected: @escaping (MailAccount, String) -> Void) {
        self.provider = provider
        self.client = client
        self.onBack = onBack
        self.onConnected = onConnected
        _emailAddress = State(initialValue: initialEmail)
        _imapUser = State(initialValue: initialUser)
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

            if provider.requiresAppPassword || provider.setupHint != nil {
                Section {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                        Text(provider.setupHint ?? "\(provider.label) verlangt ein App-spezifisches Passwort statt deines normalen Kontopassworts.")
                            .font(.system(size: DesignTokens.Typography.Size.small, weight: provider.setupSteps.isEmpty ? .regular : .medium))
                        // [2026-09-28] Schritt fuer Schritt, in der Geraetesprache.
                        ForEach(Array(provider.setupSteps.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.sm) {
                                Text("\(index + 1).")
                                    .monospacedDigit()
                                    .foregroundStyle(DesignTokens.Color.textSecondary)
                                Text(step)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .font(.system(size: DesignTokens.Typography.Size.small))
                        }
                        if let helpUrl = provider.appPasswordHelpUrl, let url = URL(string: helpUrl) {
                            Link(provider.setupLinkLabel ?? "Anleitung für \(provider.label)", destination: url)
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
        // [2026-09-28] App-Passwörter werden in Vierergruppen mit
        // Leerzeichen angezeigt, die beim Kopieren mitkommen.
        let password = provider.requiresAppPassword ? self.password.filter { !$0.isWhitespace } : self.password
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
