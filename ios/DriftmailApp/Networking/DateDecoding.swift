import Foundation

/// api-spec.yaml mixes two date shapes: `format: date-time` (e.g.
/// `Message.receivedAt`) and plain `format: date` (e.g.
/// `Contract.contractEnd`, `MailSummary.deadline`). A single
/// `.iso8601` strategy only accepts the first, so this tries both.
enum DriftmailDateDecoding {
    static let iso8601WithTime = ISO8601DateFormatter()

    static let dateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func decode(_ decoder: Decoder) throws -> Date {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        if let date = iso8601WithTime.date(from: string) {
            return date
        }
        if let date = dateOnly.date(from: string) {
            return date
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Expected date-time or date string, got \(string)"
        )
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { try decode($0) }
        return decoder
    }
}
