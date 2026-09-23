import SwiftUI

/// Wrapping row layout, mirrors the web client's `flex-wrap: wrap` used for
/// badge rows (e.g. web/src/components/MessageDetailPane.css). A plain
/// `HStack` never wraps: once its children no longer fit the available
/// width, SwiftUI compresses each `Text` down to that leftover width
/// instead, wrapping the label letter-by-letter inside its own capsule.
struct FlowLayout: Layout {
    var spacing: CGFloat = DesignTokens.Spacing.sm
    var lineSpacing: CGFloat = DesignTokens.Spacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = arrangeRows(subviews: subviews, maxWidth: maxWidth)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: min(width, maxWidth), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrangeRows(subviews: subviews, maxWidth: bounds.width)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            for item in row.items {
                item.subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct RowItem {
        let subview: LayoutSubview
        let size: CGSize
    }

    private struct Row {
        let items: [RowItem]
        let width: CGFloat
        let height: CGFloat
    }

    private func arrangeRows(subviews: Subviews, maxWidth: CGFloat) -> [Row] {
        var rows: [Row] = []
        var currentItems: [RowItem] = []
        var currentWidth: CGFloat = 0
        var currentHeight: CGFloat = 0

        func flushRow() {
            guard !currentItems.isEmpty else { return }
            rows.append(Row(items: currentItems, width: currentWidth - spacing, height: currentHeight))
            currentItems = []
            currentWidth = 0
            currentHeight = 0
        }

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let wouldOverflow = currentWidth + size.width > maxWidth && !currentItems.isEmpty
            if wouldOverflow {
                flushRow()
            }
            currentItems.append(RowItem(subview: subview, size: size))
            currentWidth += size.width + spacing
            currentHeight = max(currentHeight, size.height)
        }
        flushRow()
        return rows
    }
}
