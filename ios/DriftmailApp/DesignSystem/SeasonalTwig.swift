import SwiftUI

/// [2026-09-28] Saisonaler Zweig (Ordnerliste, Anmeldung, leerer Eingang),
/// iOS-Gegenstück zu `web/src/seasonalTwig.tsx`. Zeiträume, Motive und
/// Farben 1:1 aus contracts/design-tokens.json `seasonalTwig`; feste Farben
/// je Saison, bewusst NICHT die Akzentfarbe. Die Formen sind dieselben
/// SVG-Pfade wie auf Web (Zeichenfläche 120×96), hier über einen kleinen
/// Pfad-Übersetzer gezeichnet -- eigene Formen, keine SF Symbols.
enum Season: String, CaseIterable {
    case fruehling, sommer, herbst, weihnachten, winter

    static func current(_ date: Date = Date(), calendar: Calendar = .current) -> Season {
        let m = calendar.component(.month, from: date)
        let d = calendar.component(.day, from: date)
        switch m {
        case 3...5: return .fruehling
        case 6...8: return .sommer
        case 9...11: return .herbst
        case 12 where d <= 26: return .weihnachten
        default: return .winter
        }
    }

    var emptyInboxLine: String {
        switch self {
        case .fruehling: return "Draußen blüht es gerade."
        case .sommer: return "Ab in die Sonne."
        case .herbst: return "Zeit für einen Tee."
        case .weihnachten: return "Schöne Feiertage."
        case .winter: return "Bleib schön warm."
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .fruehling: return "Kirschblütenzweig"
        case .sommer: return "Sommerzweig mit Gänseblümchen"
        case .herbst: return "Herbstzweig mit Ahornblättern"
        case .weihnachten: return "Tannenzweig mit Christbaumkugel"
        case .winter: return "Winterzweig mit Schnee"
        }
    }
}

struct SeasonalTwigView: View {
    var season: Season = .current()
    /// Sanfte Bewegung (nur im leeren Eingang). Respektiert "Bewegung
    /// reduzieren" -- dann statisch.
    var animated = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if animated && !reduceMotion {
                TimelineView(.animation) { timeline in
                    let t = timeline.date.timeIntervalSinceReferenceDate
                    canvas(sway: sin(t * 2 * .pi / 12) * 1.2, fall: (t.truncatingRemainder(dividingBy: 7)) / 7)
                }
            } else {
                canvas(sway: 0, fall: nil)
            }
        }
        .aspectRatio(120.0 / 96.0, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel(season.accessibilityLabel)
    }

    private func canvas(sway: Double, fall: Double?) -> some View {
        Canvas { context, size in
            context.scaleBy(x: size.width / 120, y: size.height / 96)
            TwigDrawing.draw(season, in: &context, swayDegrees: sway, fallProgress: fall)
        }
    }
}

// MARK: - Zeichnung

private enum TwigDrawing {
    static let maple = SVGPath("M0 -18 L4 -10 L10 -13 L8.5 -5 L16 -6.5 L12 0 L18 4 L8 5.5 L9 12 L2 8 L0 10 L-2 8 L-9 12 L-8 5.5 L-18 4 L-12 0 L-16 -6.5 L-8.5 -5 L-10 -13 L-4 -10 Z")
    static let mapleVeins = SVGPath("M0 8 L0 -13 M0 3 L-12 -3 M0 3 L12 -3 M0 -3 L-6 -9 M0 -3 L6 -9")
    static let mapleStem = SVGPath("M0 9 L0 20")
    static let snowflake = SVGPath("M0 -6 L0 6 M-5.2 -3 L5.2 3 M-5.2 3 L5.2 -3")

    static func draw(_ season: Season, in context: inout GraphicsContext, swayDegrees: Double, fallProgress: Double?) {
        switch season {
        case .fruehling: spring(&context, sway: swayDegrees, fall: fallProgress)
        case .sommer: summer(&context, sway: swayDegrees)
        case .herbst: autumn(&context, sway: swayDegrees, fall: fallProgress)
        case .weihnachten: christmas(&context, sway: swayDegrees)
        case .winter: winter(&context, fall: fallProgress)
        }
    }

    // MARK: Bausteine

    private static func stroke(_ path: Path, _ hex: String, _ width: CGFloat, in c: inout GraphicsContext) {
        c.stroke(path, with: .color(Color(hex: hex)), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }

    private static func fill(_ path: Path, _ fillHex: String, stroke strokeHex: String? = nil, _ width: CGFloat = 1, in c: inout GraphicsContext) {
        c.fill(path, with: .color(Color(hex: fillHex)))
        if let strokeHex { stroke(path, strokeHex, width, in: &c) }
    }

    private static func transform(x: CGFloat, y: CGFloat, rotate: Double = 0, scale: CGFloat = 1) -> CGAffineTransform {
        CGAffineTransform(translationX: x, y: y).rotated(by: rotate * .pi / 180).scaledBy(x: scale, y: scale)
    }

    /// Schwingt um den Ansatzpunkt des Zweigs (8, 90), wie `transform-origin`
    /// auf Web.
    private static func swayed(_ c: GraphicsContext, degrees: Double) -> GraphicsContext {
        var copy = c
        copy.translateBy(x: 8, y: 90)
        copy.rotate(by: .degrees(degrees))
        copy.translateBy(x: -8, y: -90)
        return copy
    }

    private static func falling(_ c: GraphicsContext, progress: Double?) -> GraphicsContext {
        var copy = c
        guard let p = progress else { return copy }
        copy.translateBy(x: -6 * p, y: 22 * p)
        copy.opacity = p < 0.15 ? p / 0.15 * 0.9 : p > 0.85 ? (1 - p) / 0.15 * 0.9 : 0.9
        return copy
    }

    private static func mapleLeaf(x: CGFloat, y: CGFloat, rotate: Double, scale: CGFloat, fill fillHex: String, stroke strokeHex: String, veins: String?, in c: inout GraphicsContext) {
        let t = transform(x: x, y: y, rotate: rotate, scale: scale)
        stroke(mapleStem.path.applying(t), strokeHex, 1.2 * scale, in: &c)
        fill(maple.path.applying(t), fillHex, stroke: strokeHex, 0.9 * scale, in: &c)
        if let veins {
            var v = c
            v.opacity *= 0.8
            stroke(mapleVeins.path.applying(t), veins, 0.7 * scale, in: &v)
        }
    }

    private static func blossom(x: CGFloat, y: CGFloat, scale: CGFloat, petal: String, in c: inout GraphicsContext) {
        let t = transform(x: x, y: y, scale: scale)
        for (cx, cy) in [(0.0, -4.5), (4.3, -1.4), (2.6, 3.6), (-2.6, 3.6), (-4.3, -1.4)] {
            let circle = Path(ellipseIn: CGRect(x: cx - 4, y: cy - 4, width: 8, height: 8)).applying(t)
            fill(circle, petal, stroke: "#D97A96", 0.6 * scale, in: &c)
        }
        fill(Path(ellipseIn: CGRect(x: -1.8, y: -1.8, width: 3.6, height: 3.6)).applying(t), "#E0A33A", in: &c)
    }

    // MARK: Jahreszeiten

    private static func spring(_ c: inout GraphicsContext, sway: Double, fall: Double?) {
        stroke(SVGPath("M8 90 C 36 72, 64 52, 110 12").path, "#7A5A44", 1.8, in: &c)
        stroke(SVGPath("M58 56 C 62 46, 60 38, 54 32").path, "#7A5A44", 1.3, in: &c)
        fill(SVGPath("M34 76 C 30 66, 34 58, 42 55 C 44 64, 40 71, 34 76 Z").path, "#CFE5B8", stroke: "#6E9E4E", 0.9, in: &c)
        fill(SVGPath("M84 34 C 92 28, 100 30, 102 36 C 94 40, 88 39, 84 34 Z").path, "#CFE5B8", stroke: "#6E9E4E", 0.9, in: &c)
        var s = swayed(c, degrees: sway)
        blossom(x: 54, y: 31, scale: 1, petal: "#F7CDD8", in: &s)
        blossom(x: 74, y: 42, scale: 0.85, petal: "#FBE1E8", in: &s)
        blossom(x: 108, y: 13, scale: 0.8, petal: "#F7CDD8", in: &s)
        let bud = Path(ellipseIn: CGRect(x: -2.2, y: -3.2, width: 4.4, height: 6.4)).applying(transform(x: 94, y: 22, rotate: 40))
        fill(bud, "#EFA3B8", stroke: "#D97A96", 0.6, in: &c)
        var f = falling(c, progress: fall)
        f.opacity *= 0.8
        let petal = Path(ellipseIn: CGRect(x: -2.6, y: -1.8, width: 5.2, height: 3.6)).applying(transform(x: 40, y: 48, rotate: -20))
        fill(petal, "#F7CDD8", in: &f)
    }

    private static func summer(_ c: inout GraphicsContext, sway: Double) {
        stroke(SVGPath("M8 90 C 40 72, 70 52, 104 18").path, "#4E8A3E", 1.7, in: &c)
        for (d, hex) in [
            ("M36 74 C 30 62, 34 52, 44 48 C 46 60, 42 68, 36 74 Z", "#BFE0A8"),
            ("M52 64 C 60 58, 70 60, 74 66 C 66 70, 58 70, 52 64 Z", "#A9D48E"),
            ("M66 50 C 62 38, 68 28, 78 26 C 80 38, 74 46, 66 50 Z", "#BFE0A8"),
            ("M82 38 C 90 32, 98 34, 100 40 C 92 44, 86 43, 82 38 Z", "#A9D48E"),
        ] {
            fill(SVGPath(d).path, hex, stroke: "#4E8A3E", 1, in: &c)
        }
        var s = swayed(c, degrees: sway)
        for angle in stride(from: 0.0, to: 360.0, by: 45.0) {
            let petal = Path(ellipseIn: CGRect(x: -2.2, y: -10, width: 4.4, height: 8)).applying(transform(x: 105, y: 17, rotate: angle))
            fill(petal, "#FFFFFF", stroke: "#C9C2A8", 0.6, in: &s)
        }
        fill(Path(ellipseIn: CGRect(x: 102, y: 14, width: 6, height: 6)), "#E8B23A", stroke: "#C48A1E", 0.6, in: &s)
    }

    private static func autumn(_ c: inout GraphicsContext, sway: Double, fall: Double?) {
        stroke(SVGPath("M10 90 C 38 70, 66 50, 108 16").path, "#7A5230", 1.7, in: &c)
        var s = swayed(c, degrees: sway)
        mapleLeaf(x: 50, y: 60, rotate: -35, scale: 0.95, fill: "#B5472A", stroke: "#8A2F17", veins: "#F3D2C2", in: &s)
        mapleLeaf(x: 84, y: 36, rotate: 25, scale: 0.78, fill: "#D08A3A", stroke: "#9A5E1E", veins: "#F6E0C0", in: &s)
        mapleLeaf(x: 106, y: 16, rotate: -10, scale: 0.5, fill: "#8C5A2E", stroke: "#6A4020", veins: nil, in: &s)
        var f = falling(c, progress: fall)
        if fall == nil { f.opacity *= 0.85 }
        mapleLeaf(x: 26, y: 36, rotate: 50, scale: 0.55, fill: "#9C3B22", stroke: "#7A2A15", veins: "#F3D2C2", in: &f)
    }

    private static func christmas(_ c: inout GraphicsContext, sway: Double) {
        var dark = Path(), light = Path()
        for x in stride(from: 4.0, through: 92.0, by: 6.0) {
            let len = x > 80 ? 6.0 : 9.0
            dark.move(to: CGPoint(x: x, y: 0)); dark.addLine(to: CGPoint(x: x + len, y: -(len - 1)))
            dark.move(to: CGPoint(x: x, y: 0)); dark.addLine(to: CGPoint(x: x + len, y: len - 1))
            light.move(to: CGPoint(x: x + 3, y: 0)); light.addLine(to: CGPoint(x: x + 3 + len * 0.8, y: -(len - 1) * 0.55))
            light.move(to: CGPoint(x: x + 3, y: 0)); light.addLine(to: CGPoint(x: x + 3 + len * 0.8, y: (len - 1) * 0.55))
        }
        let branch = transform(x: 10, y: 86, rotate: -38)
        stroke(SVGPath("M0 0 L100 0").path.applying(branch), "#5B4632", 1.6, in: &c)
        stroke(dark.applying(branch), "#245A3C", 1.5, in: &c)
        stroke(light.applying(branch), "#3E7D56", 1.2, in: &c)
        // Kugel pendelt um ihren Aufhaengepunkt (66, 50).
        var b = c
        b.translateBy(x: 66, y: 50)
        b.rotate(by: .degrees(sway * 3))
        b.translateBy(x: -66, y: -50)
        stroke(SVGPath("M66 50 L66 64").path, "#B89A5A", 0.8, in: &b)
        fill(Path(roundedRect: CGRect(x: 63.5, y: 62, width: 5, height: 3), cornerRadius: 0.8), "#C9A94E", in: &b)
        fill(Path(ellipseIn: CGRect(x: 58.5, y: 64.5, width: 15, height: 15)), "#B8322F", stroke: "#8E2320", 0.8, in: &b)
        stroke(SVGPath("M62.5 69 C 63.5 67, 65.5 66.2, 67.5 66.5").path, "#F4B7B2", 1.1, in: &b)
        for (x, y, hex) in [(36.0, 58.0, "#C0392B"), (40.5, 60.0, "#C0392B"), (38.0, 54.0, "#A93226")] {
            fill(Path(ellipseIn: CGRect(x: x - 2.6, y: y - 2.6, width: 5.2, height: 5.2)), hex, in: &c)
        }
    }

    private static func winter(_ c: inout GraphicsContext, fall: Double?) {
        stroke(SVGPath("M8 90 C 38 70, 66 50, 108 16").path, "#6E625A", 1.8, in: &c)
        stroke(SVGPath("M44 66 C 42 56, 46 48, 52 42").path, "#6E625A", 1.3, in: &c)
        stroke(SVGPath("M74 44 C 82 40, 88 40, 94 44").path, "#6E625A", 1.2, in: &c)
        for d in [
            "M40 67 C 44 62, 52 58, 58 58 C 56 62, 48 66, 40 67 Z",
            "M47 50 C 48 46, 52 43, 55 42 C 55 45, 51 49, 47 50 Z",
            "M72 46 C 76 41, 84 36, 92 34 C 90 39, 80 44, 72 46 Z",
            "M84 41 C 88 39, 92 39, 95 42 C 91 43, 88 43, 84 41 Z",
        ] {
            fill(SVGPath(d).path, "#FFFFFF", stroke: "#B8C7D1", 0.7, in: &c)
        }
        fill(Path(ellipseIn: CGRect(x: 95.6, y: 23.6, width: 4.8, height: 4.8)), "#FFFFFF", stroke: "#B8C7D1", 0.6, in: &c)
        fill(Path(ellipseIn: CGRect(x: 92, y: 28, width: 4, height: 4)), "#FFFFFF", stroke: "#B8C7D1", 0.6, in: &c)
        var f = falling(c, progress: fall)
        stroke(snowflake.path.applying(transform(x: 26, y: 30)), "#7FA3BA", 0.9, in: &f)
        stroke(snowflake.path.applying(transform(x: 64, y: 20, scale: 0.7)), "#7FA3BA", 0.8, in: &f)
        stroke(snowflake.path.applying(transform(x: 100, y: 64, scale: 0.8)), "#9DB8C9", 0.8, in: &f)
    }
}

// MARK: - Logo

/// [2026-09-28] App-Logo (Schild mit Umschlag, dieselbe Form wie das
/// App-Icon und `web/public/favicon.svg`), Schild in der Theme-Markenfarbe.
struct BrandMarkView: View {
    var body: some View {
        Canvas { context, size in
            context.scaleBy(x: size.width / 120, y: size.height / 120)
            let shield = SVGPath("M60 18 L94 30 V58 C94 80 78 94 60 102 C42 94 26 80 26 58 V30 Z").path
            context.fill(shield, with: .color(DesignTokens.Color.brand))
            context.stroke(shield, with: .color(DesignTokens.Color.brand), style: StrokeStyle(lineWidth: 6, lineJoin: .round))
            context.fill(Path(roundedRect: CGRect(x: 41, y: 47, width: 38, height: 27), cornerRadius: 4), with: .color(.white))
            context.stroke(
                SVGPath("M44.5 50.5 L60 61.5 L75.5 50.5").path,
                with: .color(DesignTokens.Color.brand),
                style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
            )
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

// MARK: - Mini-SVG-Pfad-Übersetzer

/// Versteht genau die absoluten Befehle, die die Zweig-Pfade benutzen
/// (M, L, C, Z, H, V). Relative Befehle/Bögen werden bewusst nicht
/// unterstützt -- die Pfade stammen alle aus dieser Datei.
struct SVGPath {
    let path: Path

    init(_ d: String) {
        var path = Path()
        var numbers: [CGFloat] = []
        var command: Character = "M"
        var current = CGPoint.zero

        func flush() {
            switch command {
            case "M", "L":
                var i = 0
                while i + 1 < numbers.count {
                    let p = CGPoint(x: numbers[i], y: numbers[i + 1])
                    if command == "M" && i == 0 { path.move(to: p) } else { path.addLine(to: p) }
                    current = p
                    i += 2
                }
            case "H":
                for x in numbers { current = CGPoint(x: x, y: current.y); path.addLine(to: current) }
            case "V":
                for y in numbers { current = CGPoint(x: current.x, y: y); path.addLine(to: current) }
            case "C":
                var i = 0
                while i + 5 < numbers.count {
                    let c1 = CGPoint(x: numbers[i], y: numbers[i + 1])
                    let c2 = CGPoint(x: numbers[i + 2], y: numbers[i + 3])
                    let p = CGPoint(x: numbers[i + 4], y: numbers[i + 5])
                    path.addCurve(to: p, control1: c1, control2: c2)
                    current = p
                    i += 6
                }
            case "Z":
                path.closeSubpath()
            default:
                break
            }
            numbers.removeAll()
        }

        var token = ""
        func endToken() {
            if let value = Double(token) { numbers.append(CGFloat(value)) }
            token = ""
        }
        for ch in d {
            if "MLHVCZ".contains(ch) {
                endToken()
                flush()
                command = ch
                if ch == "Z" { flush(); command = " " }
            } else if ch == " " || ch == "," {
                endToken()
            } else if ch == "-" && !token.isEmpty {
                endToken()
                token = "-"
            } else {
                token.append(ch)
            }
        }
        endToken()
        flush()
        self.path = path
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 24) {
            ForEach(Season.allCases, id: \.self) { season in
                SeasonalTwigView(season: season).frame(width: 220)
            }
        }
        .padding()
    }
}
