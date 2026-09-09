import SwiftUI

/// Single place wiring up which `APIClient` and `AiAdapter` the app uses.
/// Today: mock everywhere. Once Track A's backend exists, flip
/// `apiClient` to `RemoteAPIClient()` — nothing downstream should need to
/// change since views only ever talk to the `APIClient` protocol.
@MainActor
final class AppEnvironment: ObservableObject {
    let apiClient: APIClient
    let onDeviceAdapter: AiAdapter = OnDeviceAiAdapter()
    let cloudFallbackAdapter: AiAdapter = CloudFallbackAiAdapter()

    @Published var capability: UserAiCapability?

    /// [2026-09-08] Contract-Änderung: Ordner sind jetzt benutzerdefiniert
    /// (`GET /folders`), keine feste Liste mehr. Zentral hier gehalten
    /// (statt in jeder View einzeln geladen), damit `FolderListView` und
    /// `MessageDetailView` (Verschieben-Menü) dieselbe Liste sehen, ohne
    /// den Endpunkt doppelt zu treffen.
    @Published var folders: [Folder] = []

    init(apiClient: APIClient = MockAPIClient()) {
        self.apiClient = apiClient
    }

    /// Whichever adapter matches the capability check result, defaulting
    /// to cloud fallback until the check has run.
    var activeAdapter: AiAdapter {
        capability?.activeMode == .onDevice ? onDeviceAdapter : cloudFallbackAdapter
    }

    /// Loads `folders` once and caches it; pass `forceRefresh` after a
    /// mutation (create/rename/delete/move) or on pull-to-refresh.
    func loadFolders(forceRefresh: Bool = false) async {
        if !forceRefresh && !folders.isEmpty { return }
        do {
            folders = try await apiClient.fetchFolders().sorted { $0.sortOrder < $1.sortOrder }
        } catch {
            // Leave the previous list in place; callers show their own
            // loading/error state and can retry via pull-to-refresh.
        }
    }
}
