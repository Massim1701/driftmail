import SwiftUI

/// `GET`/`PATCH /security/breaches` (WEB_INBOX.md 21.09. "NEUE AUFTRAEGE -
/// 5 Wettbewerbs-Luecken" Punkt 3, "Darkweb-/Datenleck-Ueberwachung").
/// Backend-seitig gemockt (kein echter haveibeenpwned-Aufruf, siehe
/// backend/README.md), fuer diesen Screen ohne Unterschied -- ganz normale
/// REST-Ressource.
struct DataBreachListView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var isLoading = true

    var body: some View {
        List {
            if environment.breaches.isEmpty && !isLoading {
                ContentUnavailableCompat(title: "Keine Funde", systemImage: "checkmark.shield")
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(environment.breaches) { breach in
                HStack(alignment: .top, spacing: DesignTokens.Spacing.md) {
                    Image(systemName: breach.acknowledged ? "checkmark.shield" : "exclamationmark.shield.fill")
                        .foregroundStyle(breach.acknowledged ? DesignTokens.Color.textMuted : DesignTokens.Color.warning)
                        .font(.system(size: 18))

                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                        Text(breach.breachName)
                            .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                        if let breachDate = breach.breachDate {
                            Text("Datenleck: \(breachDate.formatted(date: .abbreviated, time: .omitted))")
                                .font(.system(size: DesignTokens.Typography.Size.small))
                                .foregroundStyle(DesignTokens.Color.textSecondary)
                        }
                        Text("Gefunden am \(breach.discoveredAt.formatted(date: .abbreviated, time: .omitted))")
                            .font(.system(size: DesignTokens.Typography.Size.caption))
                            .foregroundStyle(DesignTokens.Color.textMuted)
                    }

                    Spacer()

                    if !breach.acknowledged {
                        Button("Bestätigen") {
                            Task { await acknowledge(breach) }
                        }
                        .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                    }
                }
                .listRowBackground(DesignTokens.Color.surfaceCard)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(DesignTokens.Color.surfacePage)
        .navigationTitle("Darkweb-Überwachung")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading && environment.breaches.isEmpty {
                ProgressView()
            }
        }
        .task {
            isLoading = true
            await environment.loadBreaches()
            isLoading = false
        }
        .refreshable {
            await environment.loadBreaches()
        }
    }

    private func acknowledge(_ breach: DataBreachFinding) async {
        _ = try? await environment.acknowledgeBreach(id: breach.id, acknowledged: true)
    }
}

#Preview {
    NavigationStack {
        DataBreachListView()
    }
    .environmentObject(AppEnvironment())
}
