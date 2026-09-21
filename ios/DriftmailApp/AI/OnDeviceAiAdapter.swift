import Foundation
import FoundationModels

/// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
/// "ECHTE KI-ANBINDUNG" c3ec563): Geraete-eigene KI ist jetzt die PRIMAERE
/// Quelle, siehe backend/README.md "KI-Anbindung (BYOK)" fuer die volle
/// Begruendung. Dieser Adapter versucht fuer summarize/extractContract/
/// draftReply zuerst einen ECHTEN Apple-Foundation-Models-Aufruf
/// (`FoundationModels`, verfuegbar ab iOS 26 -- im SDK dieser Umgebung
/// tatsaechlich vorhanden, per `.swiftinterface`-Inspektion verifiziert,
/// keine Annahme). Nur wenn das Modell nicht verfuegbar ist (aeltere
/// iOS-Version, Apple Intelligence nicht aktiviert, Geraet nicht
/// geeignet, Modell noch nicht bereit) ODER der Aufruf selbst fehlschlaegt,
/// faellt die Methode auf die bisherige deterministische Keyword-Heuristik
/// zurueck (unveraendert erhalten, nicht geloescht) -- analog zum
/// Graceful-Fallback-Prinzip des Backends (`src/ai/index.ts` `runAiTask()`).
///
/// `analyzeMail` (Spam-/Phishing-Klassifikation) ist bewusst NICHT Teil
/// dieser Korrektur -- bleibt unveraendert die bestehende Text-Heuristik,
/// genau wie beim Backend (Sicherheitsklassifikation soll nie von einer
/// KI-/On-Device-Einstellung abhaengen).
struct OnDeviceAiAdapter: AiAdapter {

    func analyzeMail(rawText: String, headers: [String: String]) async throws -> SecurityResult {
        let lower = rawText.lowercased()
        let urgencyWords = ["sofort", "dringend", "letzte warnung", "konto gesperrt", "innerhalb von 24 stunden"]
        let urgencyHits = urgencyWords.filter { lower.contains($0) }.count
        let urgencyScore = min(1.0, Double(urgencyHits) * 0.3)

        let mentionsIban = lower.contains("iban") && lower.contains("neue")
        // Stand-in heuristic: "аpple" below uses a Cyrillic а (U+0430), a classic homoglyph trick.
        let hasHomoglyphHint = lower.contains("аpple") || lower.contains("paypal-verifizierung")
        let spf = headers["Authentication-Results"]?.contains("spf=pass") == true ? PassFailNone.pass : .none

        // [2026-09-21] WEB_INBOX.md 19.09. "Sichtbare Kennzeichen/Badges für
        // die neuen Sicherheitssignale" -- echte Erkennung (Anzeigename vs.
        // tatsächliche Absenderdomain, Reply-To vs. From, IBAN-Wechsel im
        // Thread) braucht Header-/Thread-Kontext, den dieser einfache
        // Text-Heuristik-Stub nicht auswertet (siehe Datei-Kopfkommentar:
        // "cheap keyword/heuristic checks", kein echtes Header-Parsing wie
        // die übrigen Felder hier auch nicht). Bleiben deshalb `false` --
        // echte Erkennung läuft serverseitig (security-classification/,
        // siehe backend/README.md).
        let hasDisplayNameSpoofingHint = false
        let hasReplyToMismatchHint = false

        let suspicious = urgencyScore > 0.3 || mentionsIban || hasHomoglyphHint
        let classification: Classification = suspicious ? .phishing : .safe
        let confidence = suspicious ? 0.6 + urgencyScore * 0.1 : 0.9

        return SecurityResult(
            spfStatus: spf,
            dkimStatus: .none,
            dmarcStatus: .none,
            senderDomainAgeDays: nil,
            domainReputationScore: nil,
            homoglyphDetected: hasHomoglyphHint,
            linkMismatchDetected: false,
            displayNameSpoofingDetected: hasDisplayNameSpoofingHint,
            replyToMismatchDetected: hasReplyToMismatchHint,
            urgencyLanguageScore: urgencyScore,
            containsNewIban: mentionsIban,
            ibanChangedInThread: false,
            classification: classification,
            confidenceScore: min(confidence, 1.0)
        )
    }

    // MARK: - extractContract (Foundation Models primaer, Heuristik-Fallback)

    func extractContract(rawText: String) async throws -> ContractData? {
        if #available(iOS 26.0, *), OnDeviceModelAvailability.isAvailable {
            if let result = try? await Self.extractContractWithFoundationModels(rawText) {
                return result
            }
        }
        return Self.extractContractHeuristic(rawText)
    }

    private static func extractContractHeuristic(_ rawText: String) -> ContractData? {
        let lower = rawText.lowercased()
        guard lower.contains("vertrag") || lower.contains("abo") || lower.contains("kündigung") else {
            return nil
        }
        // Heuristic stand-in: a real implementation would run NER/date extraction.
        return ContractData(
            providerName: "Unbekannter Anbieter",
            contractStart: nil,
            contractEnd: nil,
            cancellationDeadline: nil,
            cancellationPeriodDays: nil,
            extractedConfidence: 0.2 // low on purpose -> forces UI review step
        )
    }

    @available(iOS 26.0, *)
    private static func extractContractWithFoundationModels(_ rawText: String) async throws -> ContractData? {
        let session = LanguageModelSession(
            instructions: "Du analysierst E-Mails auf Vertrags-/Abonnement-Daten (Mitgliedschaft, Abo, Vertrag). Antworte praezise und nur auf Basis des gegebenen Texts."
        )
        let prompt = "Analysiere folgende E-Mail auf Vertragsbezug:\n\n\(rawText)"
        let response = try await session.respond(to: prompt, generating: GeneratedContractExtraction.self)
        let generated = response.content
        guard generated.hasContract else { return nil }

        return ContractData(
            providerName: generated.providerName ?? "Unbekannter Anbieter",
            contractStart: generated.contractStart,
            contractEnd: generated.contractEnd,
            cancellationDeadline: generated.cancellationDeadline,
            cancellationPeriodDays: generated.cancellationPeriodDays,
            extractedConfidence: min(max(generated.confidence, 0), 1)
        )
    }

    // MARK: - summarize (Foundation Models primaer, Heuristik-Fallback)

    func summarize(rawText: String) async throws -> MailSummary {
        if #available(iOS 26.0, *), OnDeviceModelAvailability.isAvailable {
            if let result = try? await Self.summarizeWithFoundationModels(rawText) {
                return result
            }
        }
        return Self.summarizeHeuristic(rawText)
    }

    private static func summarizeHeuristic(_ rawText: String) -> MailSummary {
        let firstSentence = rawText
            .split(separator: ".")
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? rawText

        return MailSummary(
            summaryText: firstSentence.isEmpty ? "Keine Zusammenfassung verfügbar." : firstSentence,
            actionRequired: rawText.lowercased().contains("bitte"),
            actionDescription: nil,
            deadline: nil,
            // [2026-09-21] KORREKTUR: reine Keyword-Heuristik ist KEIN
            // KI-Modell, auch wenn sie on-device laeuft -- ehrlich als
            // `.heuristic` gelabelt statt `.onDevice`, analog zum Backend
            // (siehe AiSource-Kommentar in Models/Classification.swift).
            source: .heuristic
        )
    }

    @available(iOS 26.0, *)
    private static func summarizeWithFoundationModels(_ rawText: String) async throws -> MailSummary {
        let session = LanguageModelSession(
            instructions: "Du fasst E-Mails fuer den Empfaenger in einem Satz auf Deutsch zusammen und bestimmst, ob eine Aktion noetig ist."
        )
        let prompt = "Fasse folgende E-Mail zusammen:\n\n\(rawText)"
        let response = try await session.respond(to: prompt, generating: GeneratedSummary.self)
        let generated = response.content

        return MailSummary(
            summaryText: generated.summaryText,
            actionRequired: generated.actionRequired,
            actionDescription: generated.actionDescription,
            deadline: generated.deadline.flatMap { DriftmailDateDecoding.dateOnly.date(from: $0) },
            source: .onDevice
        )
    }

    // MARK: - draftReply (Foundation Models primaer, Heuristik-Fallback)

    func draftReply(thread: MailThread) async throws -> String {
        if #available(iOS 26.0, *), OnDeviceModelAvailability.isAvailable {
            if let result = try? await Self.draftReplyWithFoundationModels(thread) {
                return result
            }
        }
        return Self.draftReplyHeuristic(thread)
    }

    private static func draftReplyHeuristic(_ thread: MailThread) -> String {
        guard let last = thread.messages.last else { return "" }
        return """
        Hallo,

        vielen Dank für Ihre Nachricht bezüglich "\(last.subject)". Ich melde mich in Kürze ausführlich zurück.

        Viele Grüße
        """
    }

    @available(iOS 26.0, *)
    private static func draftReplyWithFoundationModels(_ thread: MailThread) async throws -> String {
        guard let last = thread.messages.last else { return "" }
        let session = LanguageModelSession(
            instructions: "Du schreibst hoefliche, kurze Antwortentwuerfe auf Deutsch. Antworte AUSSCHLIESSLICH mit dem Antworttext selbst -- keine Anrede-Floskeln wie \"Hier ist dein Entwurf\", keine Erklaerungen drumherum."
        )
        let prompt = "Von: \(last.fromAddress)\nBetreff: \(last.subject)\n\nMail-Text:\n\(last.bodyText)"
        let response = try await session.respond(to: prompt)
        let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw OnDeviceModelError.emptyResponse }
        return text
    }
}

// MARK: - Foundation-Models-Strukturtypen

/// [2026-09-21] Strukturierte Ausgabe ueber `@Generable`/`@Guide`
/// (FoundationModels-Makros) statt manuellem JSON-Parsing wie im
/// Backend-Pendant (`backend/src/ai/cloudAdapter.ts`) -- auf iOS gibt es
/// mit `respond(to:generating:)` einen typsicheren, vom System selbst
/// schema-gefuehrten Weg, der robuster ist als Freitext-JSON aus einem
/// String-Prompt zu parsen (kein Regex/JSON.parse-Fallback noetig).
@available(iOS 26.0, *)
@Generable
private struct GeneratedSummary {
    @Guide(description: "Zusammenfassung der E-Mail in einem Satz, auf Deutsch")
    var summaryText: String
    @Guide(description: "Ob der Empfaenger aktiv etwas tun muss")
    var actionRequired: Bool
    @Guide(description: "Kurze Beschreibung der noetigen Aktion, nil falls keine Aktion noetig ist")
    var actionDescription: String?
    @Guide(description: "Frist im Format YYYY-MM-DD, nil falls keine Frist genannt wird")
    var deadline: String?
}

@available(iOS 26.0, *)
@Generable
private struct GeneratedContractExtraction {
    @Guide(description: "Ob sich die E-Mail auf einen Vertrag/ein Abonnement bezieht")
    var hasContract: Bool
    @Guide(description: "Name des Anbieters, nil falls kein Vertragsbezug")
    var providerName: String?
    @Guide(description: "Vertragsbeginn im Format YYYY-MM-DD, nil falls unbekannt")
    var contractStart: String?
    @Guide(description: "Vertragsende im Format YYYY-MM-DD, nil falls unbekannt")
    var contractEnd: String?
    @Guide(description: "Kuendigungsfrist-Datum im Format YYYY-MM-DD, nil falls unbekannt")
    var cancellationDeadline: String?
    @Guide(description: "Kuendigungsfrist in Tagen, nil falls unbekannt")
    var cancellationPeriodDays: Int?
    @Guide(description: "Sicherheit der Erkennung zwischen 0 und 1")
    var confidence: Double
}

enum OnDeviceModelError: Error {
    case emptyResponse
}

/// [2026-09-21] Echte Verfuegbarkeitspruefung fuer Apple Intelligence/
/// Foundation Models -- ersetzt die bisherige Geraetemodell-Ratelogik in
/// `CapabilityChecker.swift` (siehe dort). Eigene, kleine Datei-lokale
/// Stelle statt Duplikation zwischen OnDeviceAiAdapter und CapabilityChecker.
enum OnDeviceModelAvailability {
    static var isAvailable: Bool {
        if #available(iOS 26.0, *) {
            return SystemLanguageModel.default.isAvailable
        }
        return false
    }

    /// Menschenlesbarer Grund, falls nicht verfuegbar -- fuer
    /// CapabilityChecker-Report/Debugging, keine reine Debug-Ausgabe.
    static var statusDescription: String {
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return "verfuegbar"
            case .unavailable(let reason):
                return "nicht verfuegbar (\(reason))"
            }
        }
        return "nicht verfuegbar (iOS < 26)"
    }
}
