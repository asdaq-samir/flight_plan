import SwiftUI

/// The map's own buttons at its top right, as Maps has them and the web
/// app's MyPositionButton: the location arrow, filled while the map
/// follows own ship and an outline otherwise, and under it the sparkle
/// that opens Ask (AskView), a question about the flight put to the
/// assistant. With a route entered and the map panned off it, the
/// arrow's other face fits the course again; tapped then, the arrow
/// comes back to bring the map to the position.
struct MapButtons: View {
    @Binding var following: Bool
    let routeAway: Bool
    let fitRoute: () -> Void
    /// Opens Ask; nil in the strip layout, where the field is the way in
    /// and no sparkle is drawn.
    let ask: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Button {
                if routeAway && !following { fitRoute() } else { following.toggle() }
            } label: {
                Image(systemName: routeAway && !following ? "point.topleft.down.to.point.bottomright.curvepath" : following ? "location.fill" : "location")
                    // The body style, so the glyph follows Dynamic Type; the
                    // 44-point round button itself does not grow.
                    .font(.body.weight(.medium))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(routeAway && !following ? "Show the whole route" : following ? "Stop following my position" : "My position")
            .background(.regularMaterial, in: Circle())
            .foregroundStyle(.primary)
            if let ask {
                Button(action: ask) {
                    Image(systemName: "sparkles")
                        .font(.body.weight(.medium))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Ask about this flight")
                .background(.regularMaterial, in: Circle())
                .foregroundStyle(Color.accentColor)
            }
        }
        .padding(.trailing, 12)
        .padding(.top, 12)
    }
}

#Preview("MapButtons") {
    @Previewable @State var following = true
    MapButtons(following: $following, routeAway: false, fitRoute: {}, ask: {})
}
