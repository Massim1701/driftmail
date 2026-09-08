import Foundation

/// STUB / MOCKED — first-pass implementation of `AiAdapter` that is meant
/// to run on-device. It does NOT run a real ML model yet: it uses cheap
/// keyword/heuristic checks so the app has a working, deterministic
/// implementation to build the UI against. Swap the method bodies for a
/// real on-device model (e.g. Core ML / Apple's on-device foundation model
/// once available) without touching call sites — that's the whole point of
/// going through the `AiAdapter` protocol.
///
/// Real on-device execution would also need capability gating (see
/// `CapabilityChecker`) before being trusted as `source: .onDevice`.
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
            urgencyLanguageScore: urgencyScore,
            containsNewIban: mentionsIban,
            classification: classification,
            confidenceScore: min(confidence, 1.0)
        )
    }

    func extractContract(rawText: String) async throws -> ContractData? {
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

    func summarize(rawText: String) async throws -> MailSummary {
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
            source: .onDevice
        )
    }

    func draftReply(thread: MailThread) async throws -> String {
        guard let last = thread.messages.last else { return "" }
        return """
        Hallo,

        vielen Dank für Ihre Nachricht bezüglich "\(last.subject)". Ich melde mich in Kürze ausführlich zurück.

        Viele Grüße
        """
    }
}

/// STUB — cloud fallback path. Real implementation would call the backend
/// (Track A / api-spec.yaml) which in turn calls a cloud AI provider
/// (see db-schema.sql `ai_provider_config`: groq/gemini/openrouter).
/// Here it just returns canned data so `activeMode == .cloudFallback`
/// devices still get a working (if fake) result end-to-end.
struct CloudFallbackAiAdapter: AiAdapter {
    func analyzeMail(rawText: String, headers: [String: String]) async throws -> SecurityResult {
        SecurityResult(
            spfStatus: .none, dkimStatus: .none, dmarcStatus: .none,
            senderDomainAgeDays: nil, domainReputationScore: nil,
            homoglyphDetected: false, linkMismatchDetected: false,
            urgencyLanguageScore: nil, containsNewIban: false,
            classification: .unclear, confidenceScore: 0.5
        )
    }

    func extractContract(rawText: String) async throws -> ContractData? { nil }

    func summarize(rawText: String) async throws -> MailSummary {
        MailSummary(
            summaryText: "Zusammenfassung über Cloud-Fallback (gemockt).",
            actionRequired: false,
            actionDescription: nil,
            deadline: nil,
            source: .cloudFallback
        )
    }

    func draftReply(thread: MailThread) async throws -> String {
        "Entwurf über Cloud-Fallback (gemockt)."
    }
}
