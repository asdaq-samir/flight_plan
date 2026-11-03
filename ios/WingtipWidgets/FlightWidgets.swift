import SwiftUI
import WidgetKit

/// The next flight on the Home Screen and the Lock Screen (a WidgetKit
/// timeline widget, Apple's way to put an app's one fact where the
/// phone is glanced at): the route with its distance, time and fuel,
/// the Brief's Go / No-Go, and the departure's weather, from the
/// snapshot the app keeps in the App Group (WidgetSnapshot, WidgetFeed).
/// The widget never asks the planner: the app's own answer is the one
/// shown, with when it last changed, and the system is asked to draw it
/// again every quarter hour so a snapshot the app has moved on from is
/// not read as fresh for long.
struct FlightWidget: Widget {
    static let kind = "FlightWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: FlightProvider()) { entry in
            FlightWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Next Flight")
        .description("The route, its Go / No-Go and the departure's weather, as last planned.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct FlightEntry: TimelineEntry {
    let date: Date
    /// Nil with no flight planned.
    let flight: WidgetSnapshot?
}

/// One entry per timeline, the snapshot as it stands: the app reloads
/// the timeline the moment the snapshot changes (WidgetFeed), so there
/// is nothing to schedule ahead.
struct FlightProvider: TimelineProvider {
    /// How long the entry stands before the system asks again.
    static let refreshAfter: TimeInterval = 15 * 60

    func placeholder(in context: Context) -> FlightEntry {
        FlightEntry(date: Date(), flight: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (FlightEntry) -> Void) {
        completion(FlightEntry(date: Date(), flight: context.isPreview ? .sample : WidgetSnapshot.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FlightEntry>) -> Void) {
        let now = Date()
        let entry = FlightEntry(date: now, flight: WidgetSnapshot.read())
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(Self.refreshAfter))))
    }
}

/// The widget by its family: a card on the Home Screen, small or
/// medium, and a line on the Lock Screen.
private struct FlightWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FlightEntry

    var body: some View {
        if let flight = entry.flight {
            switch family {
            case .accessoryRectangular:
                LockLine(flight: flight)
            case .systemMedium:
                MediumCard(flight: flight)
            default:
                SmallCard(flight: flight)
            }
        } else {
            NoFlight(family: family)
        }
    }
}

/// The small card: the route, the verdict, the figures, the departure's
/// weather in a line.
private struct SmallCard: View {
    let flight: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            RouteTitle(flight: flight)
            VerdictLine(verdict: flight.verdict)
            Spacer(minLength: 0)
            Text(FlightWords.figures(flight))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            WeatherLine(flight: flight)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

/// The medium card: the small card's left, and the departure's weather
/// at the right with the report as sent.
private struct MediumCard: View {
    let flight: WidgetSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                RouteTitle(flight: flight)
                VerdictLine(verdict: flight.verdict)
                if let words = flight.verdictWords {
                    Text(words)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Text(FlightWords.figures(flight))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("Departure \(flight.dep)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                WeatherLine(flight: flight)
                if let raw = flight.depMetarRaw {
                    // The report as sent, never reworded.
                    Text(raw)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
                Text("as of \(flight.updatedAt, style: .time)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

/// The Lock Screen's rectangle: the route, then the verdict and the
/// time, then the weather, in the system's tint.
private struct LockLine: View {
    let flight: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: "airplane")
                Text(FlightWords.route(flight))
                    .lineLimit(1)
            }
            .font(.headline)
            .widgetAccentable()
            Text("\(VerdictMark.word(flight.verdict)) · \(flight.eteMin.map(minutesWords) ?? "—")")
                .font(.subheadline.monospacedDigit())
                .lineLimit(1)
            Text(FlightWords.weather(flight))
                .font(.caption)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// No flight planned: what the widget shows until there is one.
private struct NoFlight: View {
    let family: WidgetFamily

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "airplane")
                    .foregroundStyle(.blue)
                Text("No flight planned")
                    .font(.headline)
            }
            if family != .accessoryRectangular {
                Text("Plan one in Wingtip Maps.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: family == .accessoryRectangular ? .leading : .topLeading)
    }
}

/// "C81 → KDLH", with the airplane symbol in the map's blue, as the Live
/// Activity's RouteLine writes it.
private struct RouteTitle: View {
    let flight: WidgetSnapshot

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "airplane")
                .foregroundStyle(.blue)
            Text(FlightWords.route(flight))
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .accessibilityLabel("Flight from \(flight.dep) to \(flight.dest)")
    }
}

/// The verdict's mark and word in its colour.
private struct VerdictLine: View {
    let verdict: String?

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: VerdictMark.symbol(verdict))
            Text(VerdictMark.word(verdict))
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(VerdictMark.colour(verdict))
    }
}

/// The departure's flight category in its colour and the wind in words.
private struct WeatherLine: View {
    let flight: WidgetSnapshot

    var body: some View {
        HStack(spacing: 4) {
            if let category = flight.depFlightCategory {
                Text(category)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(CategoryMark.colour(category))
            }
            Text(flight.depWind ?? (flight.depFlightCategory == nil ? "No report" : ""))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

/// The Brief's verdict in the widget's word, mark and colour: Go,
/// Caution and No-Go, as the feature is named; the marks and colours
/// the Brief's own (the app's FindingStyle, the web's lib/status).
enum VerdictMark {
    static func word(_ verdict: String?) -> String {
        switch verdict {
        case "ok": return "Go"
        case "caution": return "Caution"
        case "stop": return "No-Go"
        case "pending": return "Checking…"
        default: return "Not checked"
        }
    }

    static func symbol(_ verdict: String?) -> String {
        switch verdict {
        case "ok": return "checkmark.circle.fill"
        case "caution": return "exclamationmark.triangle.fill"
        case "stop": return "xmark.octagon.fill"
        case "pending": return "clock"
        default: return "questionmark.circle"
        }
    }

    static func colour(_ verdict: String?) -> Color {
        switch verdict {
        case "ok": return .green
        case "caution": return .orange
        case "stop": return .red
        default: return .secondary
        }
    }
}

/// A flight category in the colour aviationweather.gov draws it, which
/// the app's airport marks use: VFR green, MVFR blue, IFR red, LIFR
/// magenta.
enum CategoryMark {
    static func colour(_ category: String) -> Color {
        switch category.uppercased() {
        case "VFR": return .green
        case "MVFR": return .blue
        case "IFR": return .red
        case "LIFR": return Color(red: 0.8, green: 0.1, blue: 0.8)
        default: return .secondary
        }
    }
}

/// The snapshot's lines in the app's words (airplane, nm, gal).
enum FlightWords {
    /// "C81 → KDLH", the stops left out: the widget is read at a glance.
    static func route(_ flight: WidgetSnapshot) -> String {
        "\(flight.dep) → \(flight.dest)"
    }

    /// "212 nm · 2h 39m · 22.4 gal", each figure only where the nav log
    /// has it; "Planning…" with none.
    static func figures(_ flight: WidgetSnapshot) -> String {
        var parts: [String] = []
        if let nm = flight.distanceNm { parts.append("\(Int(nm.rounded())) nm") }
        if let minutes = flight.eteMin { parts.append(minutesWords(minutes)) }
        if let gal = flight.fuelGal { parts.append(String(format: "%.1f gal", gal)) }
        return parts.isEmpty ? "Planning…" : parts.joined(separator: " · ")
    }

    /// "VFR · West at 10 kt", or that there is no report.
    static func weather(_ flight: WidgetSnapshot) -> String {
        let parts = [flight.depFlightCategory, flight.depWind].compactMap { $0 }
        return parts.isEmpty ? "No report at \(flight.dep)" : parts.joined(separator: " · ")
    }
}

extension WidgetSnapshot {
    /// What the gallery and the placeholder show: a flight much like the
    /// fixtures' C81 to KDLH.
    static let sample = WidgetSnapshot(
        dep: "C81", dest: "KDLH", stops: [], distanceNm: 312, eteMin: 159, fuelGal: 22.4,
        verdict: "ok", verdictWords: "Nothing against the flight as planned.",
        depMetarRaw: "KUGN 031252Z 27010KT 10SM FEW050 12/03 A3012", depFlightCategory: "VFR", depWind: "West at 10 kt",
        updatedAt: Date())
}
