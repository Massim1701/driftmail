import SwiftUI

struct MessageRowView: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.md) {
            classificationBadge

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text(message.fromDisplayName ?? message.fromAddress)
                    .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)

                Text(message.subject ?? "(kein Betreff)")
                    .font(.system(size: DesignTokens.Typography.Size.body))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .lineLimit(1)
            }

            Spacer()

            Text(message.receivedAt, style: .date)
                .font(.system(size: DesignTokens.Typography.Size.caption))
                .foregroundStyle(DesignTokens.Color.textMuted)
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }

    @ViewBuilder
    private var classificationBadge: some View {
        switch message.classification {
        case .phishing:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DesignTokens.Color.danger)
        case .spam:
            Image(systemName: "trash.fill")
                .foregroundStyle(DesignTokens.Color.textMuted)
        case .unclear:
            Image(systemName: "questionmark.circle.fill")
                .foregroundStyle(DesignTokens.Color.warning)
        case .safe:
            Image(systemName: "circle.fill")
                .foregroundStyle(.clear)
        }
    }
}

#Preview {
    List {
        MessageRowView(message: Message(
            id: "1", fromAddress: "a@b.com", fromDisplayName: "Anna Weber",
            subject: "Projektupdate bis Freitag benötigt", receivedAt: .now,
            folder: .wichtig, classification: .safe
        ))
    }
}
