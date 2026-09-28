import SwiftUI

@main
struct DriftmailApp: App {
    @StateObject private var environment = AppEnvironment()

    /// [2026-09-28] Redesign "ruhig & warm": Navigations-Titel in der
    /// eingebauten Serif-Schrift (New York), wie die Serif-Ueberschriften auf
    /// Web (Fraunces). Einmal global statt in jeder Ansicht.
    init() {
        func serif(_ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
            let base = UIFont.systemFont(ofSize: size, weight: weight)
            guard let descriptor = base.fontDescriptor.withDesign(.serif) else { return base }
            return UIFont(descriptor: descriptor, size: size)
        }
        let appearance = UINavigationBar.appearance()
        appearance.largeTitleTextAttributes = [.font: serif(34, .medium)]
        appearance.titleTextAttributes = [.font: serif(18, .semibold)]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(environment)
        }
    }
}
