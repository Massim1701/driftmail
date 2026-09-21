import Foundation

/// Mirrors `components/schemas/PrivacySettings` (`GET`/`PUT
/// /privacy-settings`, WEB_INBOX.md 21.09. "NEUE AUFTRAEGE - 5
/// Wettbewerbs-Luecken" Punkt 1, "Tracking-Pixel-Blockierung").
///
/// **Wichtige Einordnung:** `blockRemoteImages` hat aktuell KEINE
/// zusätzliche technische Wirkung -- driftmail rendert nirgends HTML-Mail-
/// Inhalte, Nachrichtentext ist durchgängig Klartext (siehe
/// backend/README.md "Tracking-Schutz"). Der Schalter ist trotzdem echt
/// gespeichert, für Transparenz/Zukunftssicherheit. `blockTrackingLinks`
/// braucht die Link-Extraktion aus `message_links`, die selbst noch nicht
/// implementiert ist (separate, unabhängig entdeckte Lücke).
struct PrivacySettings: Codable, Hashable {
    var blockRemoteImages: Bool
    var blockTrackingLinks: Bool
}
