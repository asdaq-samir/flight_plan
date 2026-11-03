import Foundation
import Testing
@testable import Wingtip

/// A link opened in the app read into its command (Links), as the web
/// app writes the links it shares: ShareMenu's route, AirportCard's place,
/// AirplaneCard's flight, and a track file from Files.
struct LinksTests {
    @Test func aSharedRouteIsPlannedAsItWas() {
        let url = URL(string: "https://wingtipmaps.app/app/plan?dep=c81&stops=KJVL,KRHI&dest=kdlh&altitude_ft=4500")!
        #expect(Links.command(for: url) == .planRoute(dep: "C81", stops: ["KJVL", "KRHI"], dest: "KDLH"))
    }

    @Test func aDestinationAloneIsPlannedFromWhereTheAirplaneIs() {
        let url = URL(string: "https://wingtipmaps.app/app/plan?dest=KLAS")!
        #expect(Links.command(for: url) == .planTo(ident: "KLAS"))
    }

    @Test func aPlaceOpensItsCardAndAFlightItsAirplane() {
        #expect(Links.command(for: URL(string: "https://wingtipmaps.app/app/plan?place=KDLH")!) == .weather(ident: "KDLH"))
        #expect(Links.command(for: URL(string: "https://wingtipmaps.app/app/plan?flight=A1B2C3")!) == .aircraft(hex: "a1b2c3"))
    }

    @Test func theSignInLinkAndAnUnknownPageAreNotCommands() {
        #expect(Links.command(for: URL(string: "https://wingtipmaps.app/api/auth/magic-link/verify?token=abc")!) == nil)
        #expect(Links.command(for: URL(string: "https://wingtipmaps.app/app/plan")!) == nil)
        #expect(Links.command(for: URL(string: "https://wingtipmaps.app/app/plan?dep=C81")!) == nil)
    }

    @Test func aTrackFileIsFlownAndOtherFilesAreNot() {
        let gpx = URL(fileURLWithPath: "/tmp/flown.GPX")
        #expect(Links.command(for: gpx) == .track(gpx))
        #expect(Links.command(for: URL(fileURLWithPath: "/tmp/notes.txt")) == nil)
    }
}
