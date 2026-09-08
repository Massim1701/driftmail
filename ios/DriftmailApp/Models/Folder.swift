import SwiftUI

/// System-Ordner-Keys. Mirrors `Folder.systemKey` enum in
/// contracts/api-spec.yaml and `systemFolders.defaults[].systemKey` in
/// contracts/design-tokens.json / `folders.system_key` in db-schema.sql.
/// A user's system folders are seeded by the backend with these keys;
/// custom (user-created) folders have `systemKey == nil`.
enum SystemFolderKey: String, Codable, CaseIterable, Hashable {
    case wichtig
    case sonstiges
    case rechnungen
    case quarantaene
    case spam
}

/// Mirrors `components/schemas/Folder` in contracts/api-spec.yaml.
///
/// [2026-09-08] Contract-Änderung (SYNC.md "WICHTIGE CONTRACT-ÄNDERUNG",
/// umgesetzt Commit 734781e): der feste 5-Werte-Enum wurde durch
/// benutzerdefinierte Ordner ersetzt. `Folder` ist jetzt ein echtes Objekt
/// (id/name/icon/isSystem/systemKey/sortOrder) statt eines String-Enums —
/// Ordner können angelegt, umbenannt und (außer quarantaene/spam) gelöscht
/// werden. Die 5 System-Ordner existieren weiterhin pro Account (vom
/// Backend geseedet), sind aber jetzt Daten, keine kompilierte Konstante.
struct Folder: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var icon: String
    let isSystem: Bool
    let systemKey: SystemFolderKey?
    var sortOrder: Int

    /// SF Symbol standing in for the design-tokens.json icon keys
    /// ("star", "inbox", "receipt", "shield-exclamation", "trash") plus
    /// `customFolder.defaultIcon` ("folder") for user-created folders.
    /// Falls back to the folder glyph for any icon key this build doesn't
    /// know yet (e.g. a newer icon added server-side).
    var systemImage: String {
        switch icon {
        case "star": return "star.fill"
        case "inbox": return "tray.fill"
        case "receipt": return "doc.text.fill"
        case "shield-exclamation": return "exclamationmark.shield.fill"
        case "trash": return "trash.fill"
        default: return "folder.fill"
        }
    }

    /// design-tokens.json `systemFolders.defaults` marks quarantaene with
    /// colorRole "danger".
    var usesDangerColor: Bool { systemKey == .quarantaene }

    /// design-tokens.json `systemFolders.defaults` marks spam as "muted".
    var isMuted: Bool { systemKey == .spam }

    /// design-tokens.json `systemFolders.defaults[].renamable`: every
    /// folder can be renamed except quarantaene/spam (custom folders are
    /// always renamable, they just don't carry `renamable` in the token
    /// file since it's implied).
    var isRenamable: Bool { systemKey != .quarantaene && systemKey != .spam }

    /// api-spec.yaml `DELETE /folders/{folderId}`: "System-Ordner nicht
    /// löschbar" — only user-created folders can be removed.
    var isDeletable: Bool { !isSystem }
}
