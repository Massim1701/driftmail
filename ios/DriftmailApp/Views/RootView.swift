import SwiftUI

/// Top-level flow: onboarding capability check once, then the folder list.
/// `hasCompletedOnboarding` persists locally (UserDefaults) so the check
/// only re-runs if the user explicitly retriggers it from Settings — there
/// is no Settings screen yet in this scaffold, so for now it's one-and-done
/// per app install.
struct RootView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    var body: some View {
        if hasCompletedOnboarding {
            FolderListView()
        } else {
            OnboardingCapabilityCheckView {
                hasCompletedOnboarding = true
            }
        }
    }
}

#Preview {
    RootView()
        .environmentObject(AppEnvironment())
}
