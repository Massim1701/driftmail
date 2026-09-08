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

    init(apiClient: APIClient = MockAPIClient()) {
        self.apiClient = apiClient
    }

    /// Whichever adapter matches the capability check result, defaulting
    /// to cloud fallback until the check has run.
    var activeAdapter: AiAdapter {
        capability?.activeMode == .onDevice ? onDeviceAdapter : cloudFallbackAdapter
    }
}
