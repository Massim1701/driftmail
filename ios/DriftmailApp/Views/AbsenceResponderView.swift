import SwiftUI

/// [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent":
/// Einstellungsbildschirm für den Abwesenheitsassistenten -- Ein/Aus-
/// Schalter, Start-/End-Datumsfelder, Betreff/Text-Eingabe. Reine
/// Client-UI: die eigentliche Sicherheitslogik (kein Auto-Reply an spam/
/// phishing/Mailinglisten, Pro-Absender-Cooldown, automatischer
/// Signatur-Anhang) läuft komplett serverseitig, siehe
/// `backend/src/mail/absenceResponder.ts`. Gleicher Aufbau/Stil wie
/// `AiSettingsView.swift` (Toggle steuert nur lokalen Zustand, "Speichern"
/// löst erst den echten `PUT /absence-responder`-Aufruf aus).
struct AbsenceResponderView: View {
    @EnvironmentObject private var environment: AppEnvironment

    @State private var isActive = false
    @State private var startDate = Date()
    @State private var hasEndDate = false
    @State private var endDate = Date()
    @State private var subject = ""
    // Benannt wie in ComposeView.swift ($bodyText), nicht `body` -- das
    // wäre ein Namenskonflikt mit SwiftUIs eigener `var body: some View`.
    @State private var bodyText = ""

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
                    Toggle("Abwesenheitsassistent aktiv", isOn: $isActive)
                } footer: {
                    Text("Antwortet automatisch auf eingehende Mails im gewählten Zeitraum. Sendet NIE an Absender, die als Spam/Phishing erkannt wurden oder an Mailinglisten -- ein Sicherheitsvorteil gegenüber Gmail/Outlook.")
                }

                if isActive {
                    Section {
                        DatePicker("Start", selection: $startDate, displayedComponents: .date)
                        Toggle("Enddatum festlegen", isOn: $hasEndDate)
                        if hasEndDate {
                            DatePicker("Ende", selection: $endDate, in: startDate..., displayedComponents: .date)
                        }
                    } header: {
                        Text("Zeitraum")
                    } footer: {
                        Text("Ohne Enddatum bleibt der Assistent aktiv, bis du ihn hier wieder ausschaltest.")
                    }

                    Section {
                        TextField("Betreff", text: $subject)
                        TextEditor(text: $bodyText)
                            .frame(minHeight: 140)
                    } header: {
                        Text("Automatische Antwort")
                    } footer: {
                        Text("Deine Standard-Signatur wird automatisch angehängt, falls vorhanden.")
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
                    .disabled(isSaving)

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
        .navigationTitle("Abwesenheitsassistent")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        await environment.loadAbsenceResponder()
        guard let responder = environment.absenceResponder else { return }
        isActive = responder.active
        if let parsed = responder.startDate.flatMap(Self.dateFormatter.date(from:)) {
            startDate = parsed
        }
        if let endDateString = responder.endDate, let parsed = Self.dateFormatter.date(from: endDateString) {
            endDate = parsed
            hasEndDate = true
        } else {
            hasEndDate = false
        }
        subject = responder.subject ?? ""
        bodyText = responder.body ?? ""
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        savedConfirmation = false
        defer { isSaving = false }
        do {
            _ = try await environment.updateAbsenceResponder(
                active: isActive,
                startDate: isActive ? Self.dateFormatter.string(from: startDate) : nil,
                endDate: isActive && hasEndDate ? Self.dateFormatter.string(from: endDate) : nil,
                clearEndDate: isActive && !hasEndDate,
                subject: isActive ? subject : nil,
                body: isActive ? bodyText : nil
            )
            savedConfirmation = true
        } catch APIError.badRequest(let message) {
            errorMessage = message ?? "Ungültige Einstellung."
        } catch {
            errorMessage = "Speichern fehlgeschlagen. Bitte später erneut versuchen."
        }
    }

    /// `yyyy-MM-dd`, wie vom Backend erwartet -- dieselbe Formatierung wie
    /// `DriftmailDateDecoding.dateOnly` (dort für eingehende `GET`-Antworten
    /// genutzt), hier für ausgehende `PUT`-Requests wiederverwendet.
    private static let dateFormatter = DriftmailDateDecoding.dateOnly
}

#Preview {
    NavigationStack {
        AbsenceResponderView()
    }
    .environmentObject(AppEnvironment(previewClient: MockAPIClient()))
}
