import SwiftUI

/// [2026-09-28] Redesign "ruhig & warm" (wie web/src/components/
/// MessageList.tsx): Avatar mit Initialen in einem ruhigen, je Absender
/// festen Farbton, Absender halbfett, Betreff darunter, ruhigeres Datum
/// (heute Uhrzeit, diese Woche Wochentag, sonst Tag.Monat). Kräftige Farbe
/// nur für Sicherheits-Hinweise.
struct MessageRowView: View {
    let message: Message

    private var sender: String { message.fromDisplayName ?? message.fromAddress }

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.md) {
            AvatarView(name: sender, key: message.fromAddress)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.sm) {
                    Text(sender)
                        .font(.system(size: DesignTokens.Typography.Size.body, weight: .semibold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: DesignTokens.Spacing.sm)
                    Text(Self.shortDate(message.receivedAt))
                        .font(.system(size: DesignTokens.Typography.Size.caption))
                        .foregroundStyle(DesignTokens.Color.textMuted)
                }

                Text(message.subject ?? "(kein Betreff)")
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .lineLimit(1)

                if message.classification != .safe || message.awaitingReply {
                    HStack(spacing: 6) {
                        classificationChip
                        // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche"
                        // Punkt 2 ("Nudge"): ruhiger Hinweis, keine Warnfarbe.
                        if message.awaitingReply {
                            Chip(text: "Antwort offen", foreground: DesignTokens.Color.textSecondary, background: DesignTokens.Color.borderSubtle)
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }

    @ViewBuilder
    private var classificationChip: some View {
        switch message.classification {
        case .phishing:
            Chip(text: "Phishing-Verdacht", systemImage: "exclamationmark.shield", foreground: DesignTokens.Color.dangerText, background: DesignTokens.Color.dangerBg)
        case .spam:
            Chip(text: "Spam", systemImage: "nosign", foreground: DesignTokens.Color.textSecondary, background: DesignTokens.Color.borderSubtle)
        case .unclear:
            Chip(text: "Prüfen", systemImage: "questionmark.circle", foreground: DesignTokens.Color.warningText, background: DesignTokens.Color.warningBg)
        case .safe:
            EmptyView()
        }
    }

    static func shortDate(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        let startOfToday = calendar.startOfDay(for: now)
        if let weekAgo = calendar.date(byAdding: .day, value: -6, to: startOfToday), date >= weekAgo {
            return date.formatted(.dateTime.weekday(.abbreviated).locale(Locale(identifier: "de_DE")))
        }
        return date.formatted(.dateTime.day(.twoDigits).month(.twoDigits).locale(Locale(identifier: "de_DE")))
    }
}

private struct Chip: View {
    let text: String
    var systemImage: String? = nil
    let foreground: Color
    let background: Color

    var body: some View {
        HStack(spacing: 3) {
            if let systemImage { Image(systemName: systemImage) }
            Text(text)
        }
        .font(.system(size: 11.5, weight: .medium))
        .foregroundStyle(foreground)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(Capsule().fill(background))
    }
}

/// Initialen-Avatar mit ruhigem, je Absender stabilem Farbton (keine
/// Akzentfarbe). Gleiche fünf Töne wie `web/src/components/MessageList.css`.
struct AvatarView: View {
    let name: String
    let key: String
    var size: CGFloat = 38

    private static let tones: [(light: (String, String), dark: (String, String))] = [
        (("#E4E9DF", "#2A5E40"), ("#22332A", "#BFE5CD")),
        (("#E6E4F0", "#4B4577"), ("#2A2740", "#C9C3F0")),
        (("#F5DFCF", "#7A4B26"), ("#3A2A1E", "#EFC9A6")),
        (("#E1EAEE", "#2D5566"), ("#1E2F37", "#B3D3E0")),
        (("#F3E0E6", "#7A3550"), ("#3A2330", "#EDB8CB")),
    ]

    private var tone: (background: Color, text: Color) {
        var h: UInt32 = 0
        for scalar in key.unicodeScalars { h = h &* 31 &+ scalar.value }
        let t = Self.tones[Int(h % UInt32(Self.tones.count))]
        return (Color(light: t.light.0, dark: t.dark.0), Color(light: t.light.1, dark: t.dark.1))
    }

    private var initials: String {
        let words = name.split(whereSeparator: { " @._-<>\"".contains($0) }).filter { !$0.isEmpty }
        guard let first = words.first else { return "?" }
        if words.count == 1 { return String(first.prefix(2)).uppercased() }
        return (String(first.prefix(1)) + String(words[1].prefix(1))).uppercased()
    }

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(tone.text)
            .frame(width: size, height: size)
            .background(Circle().fill(tone.background))
            .accessibilityHidden(true)
    }
}

#Preview {
    List {
        MessageRowView(message: Message(
            id: "1", fromAddress: "a@b.com", fromDisplayName: "Anna Weber",
            subject: "Projektupdate bis Freitag benötigt", receivedAt: .now,
            folderId: "folder-wichtig", classification: .safe, inReplyToMessageId: nil
        ))
    }
}
