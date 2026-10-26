import CoreLocation
import Foundation
import SwiftUI
import Testing
@testable import Wingtip

/// A flown track replayed, as the web app's lib/map/pastFlight.test.ts
/// replays one, and the iPad's layout chosen by the size class.
@MainActor
struct ReplayTests {
    /// The web test's two reports: a climb east from 1,000 to 3,000 ft
    /// over 100 s.
    static let points = [
        Replay.Point(t: 1000, lat: 43.0, lon: -71.0, altFt: 1000, gsKt: 90, trackDeg: 90),
        Replay.Point(t: 1100, lat: 43.0, lon: -70.0, altFt: 3000, gsKt: 110, trackDeg: 90),
    ]

    @Test func theAirplaneIsBetweenItsReportsInProportionAndNowhereOutsideThem() throws {
        let here = try #require(Replay.position(Self.points, at: 1025))
        #expect(here.t == 1025 && here.lat == 43.0 && abs(here.lon - -70.75) < 1e-9)
        #expect(here.altFt == 1500)
        // Its speed and track the earlier report's, as sent.
        #expect(here.gsKt == 90 && here.trackDeg == 90)
        #expect(Replay.position(Self.points, at: 999) == nil)
        #expect(Replay.position(Self.points, at: 1101) == nil)
        #expect(Replay.position([], at: 1000) == nil)
        // At a report, its place and height; at the end, the last place,
        // its speed still the report before's, as the web app's.
        #expect(Replay.position(Self.points, at: 1000)?.altFt == 1000)
        #expect(Replay.position(Self.points, at: 1100)?.altFt == 3000)
        #expect(Replay.position(Self.points, at: 1100)?.lon == -70.0)
    }

    @Test func aHeightNotSentIsTheEarlierOnes() {
        let points = [Replay.Point(t: 0, lat: 0, lon: 0, altFt: 2000), Replay.Point(t: 10, lat: 0, lon: 1, altFt: nil),
                      Replay.Point(t: 20, lat: 0, lon: 2, altFt: 4000)]
        #expect(Replay.position(points, at: 5)?.altFt == 2000)
        #expect(Replay.position(points, at: 15)?.altFt == nil)
        // Many reports: the right pair found either side.
        let many = (0...100).map { Replay.Point(t: Double($0) * 10, lat: 0, lon: Double($0), altFt: Double($0) * 100) }
        #expect(Replay.position(many, at: 505)?.altFt == 5050)
        #expect(Replay.position(many, at: 505)?.lon == 50.5)
    }

    @Test func itPlaysAtItsSpeedStopsAtTheEndAndPlaysAgainFromTheStart() {
        let replay = Replay()
        replay.load(Self.points, key: "a")
        replay.speed = 10
        #expect(replay.at == nil && replay.fix == nil)
        replay.play()
        #expect(replay.at == 1000 && replay.playing)
        replay.step(5)                              // 5 s at 10 times: 50 s of the flight
        #expect(replay.at == 1050)
        #expect(replay.fix?.altitudeFt == 2000 && replay.fix?.groundspeedKt == 90)
        replay.pause()
        replay.step(5)
        #expect(replay.at == 1050)
        replay.play()
        #expect(replay.at == 1050)                  // from where it was left
        replay.step(60)
        #expect(replay.at == 1100 && !replay.playing)
        replay.play()
        #expect(replay.at == 1000)                  // ended: from the start
        replay.stop()
        #expect(replay.at == nil && !replay.playing && replay.fix == nil)
    }

    @Test func theScrubberStaysInsideTheFlightAndALoadedFlightKeepsItsMoment() {
        let replay = Replay()
        replay.load(Self.points, key: "a")
        replay.scrub(to: 900)
        #expect(replay.at == 1000)
        replay.scrub(to: 5000)
        #expect(replay.at == 1100)
        replay.scrub(to: 1040)
        replay.load(Self.points, key: "a")
        #expect(replay.at == 1040)
        replay.clear("b")                           // another card's: left alone
        #expect(replay.at == 1040)
        replay.clear("a")
        #expect(replay.at == nil && replay.points.isEmpty)
    }

    @Test func aGPXTracksSpeedAndTrackAreFromItsFixes() {
        // Along the equator, a thirtieth of a degree east a minute: 2 nm a
        // minute, 120 kt, on 090.
        let saved = [SavedTrackPoint(t: 0, lat: 0, lon: 0, altFt: 1000), SavedTrackPoint(t: 60_000, lat: 0, lon: 1.0 / 30, altFt: 1500),
                     SavedTrackPoint(t: 120_000, lat: 0, lon: 2.0 / 30, altFt: nil)]
        let points = Replay.points(saved)
        #expect(points.count == 3 && points[1].t == 60)
        for point in points {
            #expect(abs((point.gsKt ?? 0) - 120) < 1)
            #expect(abs((point.trackDeg ?? 0) - 90) < 0.5)
        }
        #expect(points[2].altFt == nil)
    }

    @Test func aTrackedAirplanesReportsAreTakenAsSent() {
        let sent = [PastFlightPoint(t: 1, lat: 2, lon: 3, altFt: 800, gsKt: 60, trackDeg: 270, vrateFpm: 500)]
        #expect(Replay.points(sent) == [Replay.Point(t: 1, lat: 2, lon: 3, altFt: 800, gsKt: 60, trackDeg: 270)])
    }

    @Test func theCursorSaysTheMomentsFigures() {
        #expect(ReplaySection.figures(Replay.Point(t: 0, lat: 0, lon: 0, altFt: 3040, gsKt: 107.6, trackDeg: 44)) == "3,000 ft · 108 kt · NE")
        #expect(ReplaySection.figures(Replay.Point(t: 0, lat: 0, lon: 0)) == "— · —")
    }
}

/// Which layout the root takes: the sheet on every iPhone, the split
/// with the inspector on an iPad of the regular width.
@MainActor
struct RootLayoutTests {
    @Test func theIPadAtFullWidthSplitsEverythingElseKeepsTheSheet() {
        #expect(RootLayout.of(.regular, pad: true) == .split)
        #expect(RootLayout.of(.compact, pad: true) == .sheet)       // an iPad in a narrow Split View
        #expect(RootLayout.of(nil, pad: true) == .sheet)
        #expect(RootLayout.of(.regular, pad: false) == .sheet)      // an iPhone Max held sideways
        #expect(RootLayout.of(.compact, pad: false) == .sheet)
    }

    @Test func aFieldAndAPointOpenInTheInspectorTheListsStayInTheSidebar() {
        #expect(RootLayout.inspects(AirportRoute("KDAW")))
        #expect(RootLayout.inspects(AirportRoute(AirportRoute.airspace(lat: 43.1, lon: -70.9).text)))
        #expect(!RootLayout.inspects(.list(.favorites)))
        #expect(!RootLayout.inspects(AirportRoute(AirportRoute.nearFrom(lat: 43.1, lon: -70.9, label: "Dover, NH").text)))
    }

    @Test func aCardsLinkIsFPLsOwnPageOnTheIPhone() {
        #expect(CardLink<EmptyView>.page(.profile) == "profile")
        #expect(CardLink<EmptyView>.page(.brief) == "brief")
    }
}
