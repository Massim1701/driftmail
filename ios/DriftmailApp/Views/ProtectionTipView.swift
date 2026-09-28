import SwiftUI

// [2026-09-28] WEB_INBOX.md 28.09. "WILLKOMMENSBILDSCHIRM - wechselnde
// Schutz-Tipps": kleiner Tipp-Bereich unter dem Leitsatz, wechselt etwa alle
// 10 Sekunden mit sanftem Überblenden (bei "Bewegung reduzieren" ohne).
// Die Tipps kommen aus contracts/protection-tips.json, das als Bundle-
// Ressource eingebunden ist (gemeinsame Quelle mit Web). Reihenfolge pro
// Besuch neu gemischt, keine Wiederholung, bis alle einmal gezeigt wurden.

enum ProtectionTips {
    private struct File: Decodable { let tips: [String] }

    static let all: [String] = {
        guard let url = Bundle.main.url(forResource: "protection-tips", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data) else { return [] }
        return file.tips
    }()
}

struct ProtectionTipView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var order: [Int] = ProtectionTipView.shuffled()
    @State private var pos = 0

    private static let interval: Duration = .seconds(10)
    private let tips = ProtectionTips.all

    var body: some View {
        if !tips.isEmpty {
            VStack(spacing: DesignTokens.Spacing.xs) {
                Text("Schutz-Tipp")
                    .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.accent)

                // Alle Tipps unsichtbar übereinander: die Höhe richtet sich nach
                // dem längsten Tipp, beim Wechsel springt das Layout nicht.
                ZStack {
                    ForEach(tips.indices, id: \.self) { i in
                        tipText(tips[i]).hidden().accessibilityHidden(true)
                    }
                    tipText(tips[order[pos]])
                        .id(pos)
                        .transition(.opacity)
                }

                Button("Nächster Tipp") { advance() }
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.textMuted)
            }
            .padding(.horizontal, DesignTokens.Spacing.xl)
            // Neustart des Timers bei jedem Wechsel, damit ein manuelles
            // "Nächster Tipp" die volle Anzeigedauer bekommt.
            .task(id: pos) {
                try? await Task.sleep(for: Self.interval)
                if !Task.isCancelled { advance() }
            }
        }
    }

    private func tipText(_ tip: String) -> some View {
        Text(tip)
            .font(.system(size: DesignTokens.Typography.Size.body))
            .foregroundStyle(DesignTokens.Color.textSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func advance() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
            if pos + 1 < order.count {
                pos += 1
            } else {
                order = Self.shuffled(avoidFirst: order[pos])
                pos = 0
            }
        }
    }

    private static func shuffled(avoidFirst: Int? = nil) -> [Int] {
        var order = Array(ProtectionTips.all.indices).shuffled()
        // Beim Neumischen nicht direkt den zuletzt gezeigten Tipp wiederholen.
        if let avoidFirst, order.count > 1, order[0] == avoidFirst {
            order.swapAt(0, 1)
        }
        return order
    }
}
