import SwiftUI

/// System-Ordner-Keys. Mirrors `Folder.systemKey` enum in
/// contracts/api-spec.yaml and `systemFolders.defaults[].systemKey` in
/// contracts/design-tokens.json / `folders.system_key` in db-schema.sql.
/// A user's system folders are seeded by the backend with these keys;
/// custom (user-created) folders have `systemKey == nil`.
///
/// [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
/// Ordner-Umbau-Eintrags"): `wichtig`/`rechnungen` entfallen als
/// System-Ordner (der User kann beides weiterhin als eigenen Ordner
/// anlegen), `eingang`/`entwuerfe`/`gesendet` sind neu.
enum SystemFolderKey: String, Codable, CaseIterable, Hashable {
    /// Echte automatische Landezone für neue, normale Mail (ersetzt
    /// `wichtig`). Umbenennbar wie zuvor `sonstiges`/`wichtig`.
    case eingang
    /// Nicht umbenennbar/löschbar. Zeigt `GET /drafts`, NICHT
    /// `GET /messages` (siehe `APIClient.fetchDrafts`).
    case entwuerfe
    /// Nicht umbenennbar/löschbar. Enthält lokale `Message`-Zeilen, die das
    /// Backend nach einem erfolgreichen `POST /messages/send` selbst anlegt.
    case gesendet
    case sonstiges
    case quarantaene
    case spam
    /// [2026-09-08] Neu (WEB_INBOX.md "Fehlende Basis-Funktion entdeckt",
    /// Contract-Teil Commit 156f0fd): Ziel-Ordner für manuelles Löschen
    /// (soft delete, analog Gmail). Nicht umbenennbar/löschbar wie
    /// quarantaene/spam.
    case papierkorb
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
    /// ("star", "inbox", "receipt", "shield-exclamation", "trash",
    /// "trash-2" für Papierkorb, "file-text" für Entwürfe, "send" für
    /// Gesendet — beide neu seit dem Ordner-Umbau 09.09.) plus
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
        case "trash-2": return "trash.slash.fill"
        case "file-text": return "doc.text.fill"
        case "send": return "paperplane.fill"
        default: return "folder.fill"
        }
    }

    /// design-tokens.json `systemFolders.defaults` marks quarantaene with
    /// colorRole "danger".
    var usesDangerColor: Bool { systemKey == .quarantaene }

    /// design-tokens.json `systemFolders.defaults` marks spam as "muted".
    var isMuted: Bool { systemKey == .spam }

    /// design-tokens.json `systemFolders.defaults[].renamable`: every
    /// folder can be renamed except quarantaene/spam/papierkorb/entwuerfe/
    /// gesendet (custom folders are always renamable, they just don't
    /// carry `renamable` in the token file since it's implied).
    var isRenamable: Bool {
        systemKey != .quarantaene && systemKey != .spam && systemKey != .papierkorb
            && systemKey != .entwuerfe && systemKey != .gesendet
    }

    /// api-spec.yaml `DELETE /folders/{folderId}`: "System-Ordner nicht
    /// löschbar" — only user-created folders can be removed.
    var isDeletable: Bool { !isSystem }

    /// Der Papierkorb-Ordner selbst (soft-delete-Ziel, WEB_INBOX.md
    /// 08.09. "Fehlende Basis-Funktion entdeckt"). Zeigt an, wo zusätzlich
    /// "Endgültig löschen" angeboten wird.
    var isTrash: Bool { systemKey == .papierkorb }

    /// Der Entwürfe-Ordner (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
    /// Ordner-Umbau-Eintrags"). Zeigt an, wo `InboxListView` `GET /drafts`
    /// statt `GET /messages` lädt (siehe `DraftListView`).
    var isDrafts: Bool { systemKey == .entwuerfe }
}
