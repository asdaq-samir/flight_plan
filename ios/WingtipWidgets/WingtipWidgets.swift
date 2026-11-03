import ActivityKit
import SwiftUI
import WidgetKit

/// The widget extension: the next flight on the Home Screen and the Lock
/// Screen (FlightWidget, FlightWidgets.swift), and the flight in progress
/// on the Lock Screen and in the Dynamic Island (a Live Activity, the
/// owner's ask of 2026-11-03, as Apple recommends for anything ongoing).
/// Only the Shared folder's files are compiled with the app; the views
/// here draw from the attributes' content state and the App Group's
/// snapshot alone.
@main
struct WingtipWidgetsBundle: WidgetBundle {
    var body: some Widget {
        FlightWidget()
        FlightActivityWidget()
    }
}

/// The flight's route, the next checkpoint with the miles to go, the ETA
/// as a clock time and the fuel the plan expects left, in the app's words
/// (airplane, nm, gal, ft).
struct FlightActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FlightActivityAttributes.self) { context in
            FlightBanner(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RouteLine(dep: context.attributes.dep, dest: context.attributes.dest)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    EtaLine(state: context.state)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .firstTextBaseline) {
                        NextCheckpointLine(state: context.state)
                        Spacer(minLength: 8)
                        FuelLine(state: context.state)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "airplane")
                    .foregroundStyle(.blue)
            } compactTrailing: {
                Text(minutesWords(context.state.etaMinutes))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.primary)
            } minimal: {
                Image(systemName: "airplane")
                    .foregroundStyle(.blue)
            }
        }
    }
}

/// The Lock Screen's banner, and the notification-style view on a phone
/// with no Dynamic Island.
private struct FlightBanner: View {
    let attributes: FlightActivityAttributes
    let state: FlightActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                RouteLine(dep: attributes.dep, dest: attributes.dest)
                Spacer(minLength: 8)
                EtaLine(state: state)
            }
            HStack(alignment: .firstTextBaseline) {
                NextCheckpointLine(state: state)
                Spacer(minLength: 8)
                FuelLine(state: state)
            }
        }
        .padding(14)
    }
}

/// "C81 → KDLH", with the airplane symbol in the map's blue.
private struct RouteLine: View {
    let dep: String
    let dest: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "airplane")
                .foregroundStyle(.blue)
            Text("\(dep) → \(dest)")
                .font(.headline)
                .lineLimit(1)
        }
        .accessibilityLabel("Flight from \(dep) to \(dest)")
    }
}

/// The arrival as a clock time, and the minutes to it under.
private struct EtaLine: View {
    let state: FlightActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(state.eta, style: .time)
                .font(.title3.monospacedDigit().weight(.semibold))
            Text("ETA · \(minutesWords(state.etaMinutes))")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The next checkpoint and the miles still to fly to the destination.
private struct NextCheckpointLine: View {
    let state: FlightActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let next = state.nextCheckpoint {
                Text("Next \(next)")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
            } else if let to = state.legTo {
                Text("To \(to)")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
            } else {
                Text("En route")
                    .font(.subheadline.weight(.medium))
            }
            Text("\(state.toGoNm, specifier: "%.0f") nm to go")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The fuel the plan expects left, to a tenth of a gallon; nothing where
/// the plan has no fuel figures.
private struct FuelLine: View {
    let state: FlightActivityAttributes.ContentState

    var body: some View {
        if let fuel = state.fuelRemainingGal {
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(fuel, specifier: "%.1f") gal")
                    .font(.subheadline.monospacedDigit().weight(.medium))
                Text("planned fuel left")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Minutes as a pilot reads them: "2h 39m", or "41m" under an hour; the
/// Home Screen widget's lines (FlightWidgets.swift) read it too.
func minutesWords(_ minutes: Double) -> String {
    let whole = max(0, Int(minutes.rounded()))
    let hours = whole / 60, rest = whole % 60
    return hours > 0 ? "\(hours)h \(rest)m" : "\(rest)m"
}
