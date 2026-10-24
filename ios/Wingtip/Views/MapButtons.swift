import SwiftUI

/// The map's own buttons at its top right, as Maps has them and the web
/// app's MyPositionButton: the location arrow, filled while the map
/// follows own ship and an outline otherwise. With a route entered and
/// the map panned off it, the arrow's other face fits the course again;
/// tapped then, the arrow comes back to bring the map to the position.
struct MapButtons: View {
    @Binding var following: Bool
    let routeAway: Bool
    let fitRoute: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button {
                if routeAway && !following { fitRoute() } else { following.toggle() }
            } label: {
                Image(systemName: routeAway && !following ? "point.topleft.down.to.point.bottomright.curvepath" : following ? "location.fill" : "location")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(routeAway && !following ? "Show the whole route" : following ? "Stop following my position" : "My position")
            .background(.regularMaterial, in: Circle())
            .foregroundStyle(.primary)
        }
        .padding(.trailing, 12)
        .padding(.top, 12)
    }
}
