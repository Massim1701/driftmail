import Foundation

/// Mirrors `components/schemas/DataBreachFinding` (`GET /security/breaches`,
/// `PATCH /security/breaches/{breachId}`, WEB_INBOX.md 21.09. "NEUE
/// AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 3, "Darkweb-/Datenleck-
/// Ueberwachung"). Mock-Anbindung backend-seitig (kein echter
/// haveibeenpwned-Aufruf, siehe backend/README.md) -- der Client selbst
/// merkt davon nichts, ganz normale REST-Ressource.
struct DataBreachFinding: Codable, Identifiable, Hashable {
    let id: String
    let accountId: String
    let breachName: String
    let breachDate: Date?
    let discoveredAt: Date
    var acknowledged: Bool
}
