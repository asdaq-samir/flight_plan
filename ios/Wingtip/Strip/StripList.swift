import SwiftUI

/// The strip's timeline: the departure's card, each checkpoint a row --
/// its name, "MH 318 · 24 NM", the leg's minutes at the right -- a stop's
/// card, the destination's, on one magenta line, the middle folded where
/// there are more than six checkpoints; and after the destination the
/// way to the debrief. The points are the plan's own (StripData.points);
/// a checkpoint's row opens its leg in the nav log, a field's its card.
struct StripList: View {
    let points: [StripPoint]
    let onField: (String) -> Void
    let onPlates: (String) -> Void
    let onClearance: () -> Void
    let onLeg: (Leg) -> Void
    let onDebrief: () -> Void
    @Environment(\.chartInk) private var ink
    @State private var unfolded = false

    var body: some View {
        if let first = points.first, let last = points.last, first.kind == .departure, points.count >= 2 {
            let middle = Array(points.dropFirst().dropLast())
            let fold = StripData.folded(middle, unfolded: unfolded)
            let numbers = StripData.numbers(middle)
            ZStack(alignment: .topLeading) {
                // The timeline's line: 4 points of magenta at the left,
                // each entry's dot on it.
                RoundedRectangle(cornerRadius: 2).fill(ink.magenta).frame(width: 4).padding(.leading, 7).padding(.vertical, 12)
                VStack(alignment: .leading, spacing: 8) {
                    StripFieldCard(point: first, atLabel: "leaving", clearance: true, plates: false,
                                   onOpen: onField, onPlates: onPlates, onClearance: onClearance)
                    ForEach(Array(fold.rows.enumerated()), id: \.offset) { _, row in
                        if let row {
                            if row.kind == .checkpoint {
                                checkpoint(row, number: numbers[row.key])
                            } else {
                                StripFieldCard(point: row, atLabel: "ETA", clearance: false, plates: false,
                                               onOpen: onField, onPlates: onPlates, onClearance: onClearance)
                            }
                        } else {
                            foldRow(fold.hidden)
                        }
                    }
                    if last.kind == .destination {
                        StripFieldCard(point: last, atLabel: "ETA", clearance: false, plates: true,
                                       onOpen: onField, onPlates: onPlates, onClearance: onClearance)
                    }
                    after
                }
            }
            .accessibilityIdentifier("strip-list")
        }
    }

    /// A checkpoint's row: its number and name, the leg's magnetic heading
    /// and distance under it (the nav log's figures), its minutes at the
    /// right; a tap opens the leg.
    private func checkpoint(_ point: StripPoint, number: Int?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(ink.brown).frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(ink.paper, lineWidth: 3).padding(-3))
                .padding(.leading, 2).padding(.top, 15)
            Button {
                if let leg = point.leg { onLeg(leg) }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(number.map { "\($0). " } ?? "")\(point.name)")
                            .font(ChartInk.text.weight(.medium)).lineLimit(1)
                        if let leg = point.leg {
                            Text("MH \(String(format: "%03d", Int(leg.magneticHeadingDeg.rounded()))) · \(Int(leg.distanceNm.rounded())) NM")
                                .font(ChartInk.note.monospacedDigit()).foregroundStyle(ink.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let ete = point.leg?.eteMin {
                        Text(StripData.duration(ete)).font(ChartInk.detail.monospacedDigit()).foregroundStyle(ink.muted)
                    }
                }
                .padding(.horizontal, 4).padding(.vertical, 6)
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the leg in the nav log")
        }
    }

    /// "N more checkpoints", a tap unfolds them.
    private func foldRow(_ hidden: Int) -> some View {
        HStack(spacing: 12) {
            Circle().fill(ink.paper).frame(width: 8, height: 8)
                .overlay(Circle().strokeBorder(ink.brown, lineWidth: 2))
                .padding(.leading, 5)
            Button("\(hidden) more checkpoints") { withAnimation(.easeOut(duration: 0.3)) { unfolded = true } }
                .font(ChartInk.text.weight(.semibold))
                .frame(minHeight: 44)
                .buttonStyle(.plain)
                .foregroundStyle(ink.tint)
        }
    }

    /// After the destination: the debrief, once a track is flown -- the
    /// saved flight's own page reads it (FlownTrackView's DebriefSections).
    private var after: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(ink.paper).frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(ink.magenta, lineWidth: 2))
                .padding(.leading, 2).padding(.top, 15)
            Button(action: onDebrief) {
                HStack(spacing: 10) {
                    Image(systemName: "flag.checkered").foregroundStyle(ink.tint).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Debrief").font(ChartInk.text.weight(.semibold))
                        Text("After the flight, from its saved track").font(ChartInk.note).foregroundStyle(ink.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right").foregroundStyle(ink.tint).accessibilityHidden(true)
                }
                .padding(14)
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .inkCard()
        }
    }
}

/// A field's card on the line: its ident and name, the time there, the
/// runway and wind, its chips -- ATIS, TOWER or CTAF, the clearance step
/// at the departure, PLATES at the destination. The ident is the way
/// into its card. The field's own card is fetched for the frequencies
/// and the weather (Planner.place), as the web's rows share airportQuery.
struct StripFieldCard: View {
    let point: StripPoint
    let atLabel: String
    let clearance: Bool
    let plates: Bool
    let onOpen: (String) -> Void
    let onPlates: (String) -> Void
    let onClearance: () -> Void
    @Environment(\.chartInk) private var ink
    @State private var place: AirportPlace?

    private var detail: String? {
        var parts: [String] = []
        if let runway = StripData.runwayInUse(place?.runways ?? []) { parts.append("Runway \(runway)") }
        if let weather = StripData.weatherLine(place?.metar) { parts.append(weather) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(ink.field).frame(width: 18, height: 18).padding(.top, 16)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Button { onOpen(point.name) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(point.name).font(ChartInk.text.weight(.bold)).foregroundStyle(ink.tint)
                            if !point.longName.isEmpty {
                                Text(point.longName).font(ChartInk.detail).foregroundStyle(ink.muted).lineLimit(1)
                            }
                        }
                        .contentShape(Rectangle().inset(by: -8))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(point.name), \(point.longName)")
                    .accessibilityHint("Opens the field's card")
                    Spacer(minLength: 0)
                    if let minutes = point.minutesFlown {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Formats.time(Date().addingTimeInterval(minutes * 60)))
                                .font(ChartInk.text.weight(.semibold).monospacedDigit())
                            Text(atLabel).font(ChartInk.note).foregroundStyle(ink.muted)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if let detail {
                    Text(detail).font(ChartInk.detail).foregroundStyle(ink.ink.opacity(0.8))
                } else if let ground = point.leg?.groundMin, point.kind == .stop, ground > 0 {
                    Text("\(StripData.duration(ground)) on the ground").font(ChartInk.detail).foregroundStyle(ink.ink.opacity(0.8))
                }
                chips
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .inkCard()
        }
        .task(id: point.name) {
            place = try? await Planner.place(point.name)
        }
    }

    @ViewBuilder
    private var chips: some View {
        let radio = place.map { StripData.radioChips($0.frequencies, towered: $0.towered) } ?? []
        if !radio.isEmpty || clearance || plates {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(radio, id: \.label) { chip in
                        Button(chip.label) { onOpen(point.name) }
                            .buttonStyle(.inkChip)
                            .accessibilityLabel(chip.words)
                    }
                    if clearance {
                        Button("Clearance", action: onClearance).buttonStyle(.inkChip).accessibilityLabel("The clearance card")
                    }
                    if plates {
                        Button("Plates") { onPlates(point.name) }.buttonStyle(.inkChip).accessibilityLabel("The approach plates")
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }
}
