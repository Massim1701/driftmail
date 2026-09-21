import Foundation

/// [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent":
/// mirrors `components/schemas/AbsenceResponder` in contracts/api-spec.yaml
/// and db-schema.sql `absence_responder`. `startDate`/`endDate` bleiben
/// bewusst rohe "yyyy-MM-dd"-Strings statt `Date` -- es gibt in diesem
/// Scaffold noch keine etablierte Konvention, ein `Date`-Feld beim
/// AUSGEHENDEN `PUT`-Request wieder korrekt als Datums-String zu kodieren
/// (der generische `JSONEncoder()` in `RemoteAPIClient` würde ohne eigene
/// `dateEncodingStrategy` sonst einen Unix-Timestamp senden). Die
/// Umwandlung zu/von `Date` für die `DatePicker`-Bindings passiert lokal in
/// `AbsenceResponderView` über `DriftmailDateDecoding.dateOnly`.
struct AbsenceResponder: Codable, Hashable {
    var active: Bool
    var startDate: String?
    var endDate: String?
    var subject: String?
    var body: String?
}
