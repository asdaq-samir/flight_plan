import CoreLocation
import Foundation
import Testing
@testable import Wingtip

/// The one field's parser (FieldCommands), the web app's
/// features/strip/fieldCommands.test.ts case for case, so the phone
/// reads a line as the website does.
struct FieldCommandsTests {
    @Test func readsNothingFromAnEmptyLine() {
        #expect(FieldCommands.read("") == nil)
        #expect(FieldCommands.read("   ") == nil)
    }

    @Test func readsIdentsAsARouteOneTheDestinationTwoTheEndsMoreTheStopsBetween() {
        #expect(FieldCommands.read("KDLH") == .route(dep: nil, stops: [], dest: "KDLH"))
        #expect(FieldCommands.read("kdlh") == .route(dep: nil, stops: [], dest: "KDLH"))
        #expect(FieldCommands.read("C81 KDLH") == .route(dep: "C81", stops: [], dest: "KDLH"))
        #expect(FieldCommands.read("C81 to KDLH via KJVL") == .route(dep: "C81", stops: ["KJVL"], dest: "KDLH"))
        #expect(FieldCommands.read("C81 via KJVL to KDLH") == .route(dep: "C81", stops: ["KJVL"], dest: "KDLH"))
        #expect(FieldCommands.read("KDLH via KJVL") == .route(dep: nil, stops: ["KJVL"], dest: "KDLH"))
        #expect(FieldCommands.read("C81, KJVL, KDLH") == .route(dep: "C81", stops: ["KJVL"], dest: "KDLH"))
        #expect(FieldCommands.read("C81 → KDLH") == .route(dep: "C81", stops: [], dest: "KDLH"))
        #expect(FieldCommands.read("to KDLH") == .route(dep: nil, stops: [], dest: "KDLH"))
        #expect(FieldCommands.read("fly to kdlh") == .route(dep: nil, stops: [], dest: "KDLH"))
        #expect(FieldCommands.read("KDLH from C81") == .route(dep: "C81", stops: [], dest: "KDLH"))
    }

    @Test func takesThreeSmallLettersAsAWordNotAFieldAndThreeCapitalsAsAField() {
        #expect(FieldCommands.read("ORD") == .route(dep: nil, stops: [], dest: "ORD"))
        #expect(FieldCommands.read("ord") == .place("ord"))
        #expect(FieldCommands.read("fly") == .place("fly"))
    }

    @Test func opensAScreenByItsWordWithTheFillerTakenOff() {
        #expect(FieldCommands.read("Brief me") == .open(.brief))
        #expect(FieldCommands.read("brief") == .open(.brief))
        #expect(FieldCommands.read("My airplane") == .open(.airplane))
        #expect(FieldCommands.read("open my logbook") == .open(.logbook))
        #expect(FieldCommands.read("Settings") == .open(.settings))
        #expect(FieldCommands.read("setup") == .open(.settings))
        #expect(FieldCommands.read("instructor") == .open(.instructor))
        #expect(FieldCommands.read("Nearest fuel") == .open(.fuel))
        #expect(FieldCommands.read("nearest") == .open(.nearest))
        #expect(FieldCommands.read("show me the routes") == .open(.routes))
        #expect(FieldCommands.read("Altitude") == .open(.altitude))
        #expect(FieldCommands.read("procedures") == .open(.procedures))
        #expect(FieldCommands.read("Nav log") == .open(.navlog))
        #expect(FieldCommands.read("file flight plan") == .open(.file))
        #expect(FieldCommands.read("clearance") == .open(.clearance))
        #expect(FieldCommands.read("dry run") == .open(.dryrun))
        #expect(FieldCommands.read("stops") == .open(.stops))
    }

    @Test func opensAFieldsCardByItsIdentNotARouteToIt() {
        #expect(FieldCommands.read("about KDLH") == .field("KDLH"))
        #expect(FieldCommands.read("KDLH info") == .field("KDLH"))
        #expect(FieldCommands.read("C81 airport") == .field("C81"))
        #expect(FieldCommands.read("recent routes") == .open(.recentRoutes))
    }

    @Test func readsAShortNameWithNoQuestionInItAsAPlaceToFlyTo() {
        #expect(FieldCommands.read("Duluth") == .place("Duluth"))
        #expect(FieldCommands.read("to Duluth") == .place("Duluth"))
        #expect(FieldCommands.read("Las Vegas") == .place("Las Vegas"))
        #expect(FieldCommands.read("plan a trip to Las Vegas") == .place("Las Vegas"))
        #expect(FieldCommands.read("fly to Madison") == .place("Madison"))
        #expect(FieldCommands.read("take me to Duluth") == .place("Duluth"))
    }

    @Test func asksTheAssistantEverythingElse() {
        #expect(FieldCommands.read("Weather at KDLH") == .ask("Weather at KDLH"))
        #expect(FieldCommands.read("Can I make Duluth before dark?") == .ask("Can I make Duluth before dark?"))
        #expect(FieldCommands.read("Is the weather within my minimums") == .ask("Is the weather within my minimums"))
        #expect(FieldCommands.read("What if I leave an hour later?") == .ask("What if I leave an hour later?"))
        #expect(FieldCommands.read("winds aloft on the way to Duluth") == .ask("winds aloft on the way to Duluth"))
    }

    @Test func anIdentIsThreeOrFourLettersAndDigitsUppercased() {
        #expect(FieldCommands.identOf(" kdlh ") == "KDLH")
        #expect(FieldCommands.identOf("c81") == "C81")
        #expect(FieldCommands.identOf("KDLHX") == "")
        #expect(FieldCommands.identOf("K-LH") == "")
    }
}

/// The strip built from the plan's parts (StripData): the points in
/// order from the nav log's legs as the planner streams them
/// (NavLogTests' lines), the airplane's place along them, and the words
/// the ribbon and the head carry; and the head's findings from the
/// planner's Go / No-Go as GoNoGoTests shapes it, through the glance.
struct StripDataTests {
    private static let decoder = Planner.snakeCase

    /// Three legs of a route with a stop: C81 to KJVL (a checkpoint on
    /// the way), KJVL to KDLH, the figures the planner's leg lines carry.
    private static let legLines = [
        #"{"type":"leg","from":"C81","to":"ROCKFORD","distance_nm":30.0,"altitude_ft":4500.0,"true_course_deg":330.0,"wca_deg":0.0,"true_heading_deg":330.0,"magnetic_variation_deg":1.0,"magnetic_heading_deg":329.0,"groundspeed_kt":104.0,"ete_min":17.3,"fuel_gal":2.4,"tas_kt":110.0}"#,
        #"{"type":"leg","from":"ROCKFORD","to":"KJVL","distance_nm":20.0,"altitude_ft":4500.0,"true_course_deg":330.0,"wca_deg":0.0,"true_heading_deg":330.0,"magnetic_variation_deg":1.0,"magnetic_heading_deg":329.0,"groundspeed_kt":104.0,"ete_min":11.5,"fuel_gal":1.6,"tas_kt":110.0,"ground_min":45.0}"#,
        #"{"type":"leg","from":"KJVL","to":"KDLH","distance_nm":273.5,"altitude_ft":6500.0,"true_course_deg":330.0,"wca_deg":0.0,"true_heading_deg":330.0,"magnetic_variation_deg":-1.0,"magnetic_heading_deg":331.0,"groundspeed_kt":100.0,"ete_min":164.1,"fuel_gal":22.9,"tas_kt":110.0}"#,
    ]

    private static func legs() throws -> [Leg] {
        try legLines.map { try decoder.decode(Leg.self, from: Data($0.utf8)) }
    }

    private static func course() throws -> Course {
        let json = #"{"departure":{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07},"destination":{"ident":"KDLH","name":"Duluth International","lat":46.84,"lon":-92.19},"stops":[{"ident":"KJVL","name":"Southern Wisconsin Regional","lat":42.62,"lon":-89.04}],"distance_nm":323.5,"bearing_deg":325.0,"course_line":[[42.32,-88.07],[42.62,-89.04],[46.84,-92.19]],"chart_cycle":"09-03-2026","chart_layers":[],"min_zoom":5,"max_zoom":12}"#
        return try decoder.decode(Course.self, from: Data(json.utf8))
    }

    private static let checkpoints = [
        Checkpoint(alongTrackNm: 30, category: "city", hop: 0, id: "rockford", lat: 42.27, lon: -89.09, name: "Rockford", predictedScore: 0.9, selected: true, waypoint: nil),
    ]

    @Test func thePointsAreTheLegsEndsInOrderAStopWhereTheRouteLandsTheDestinationLast() throws {
        let points = StripData.points(dep: "C81", dest: "KDLH", stops: ["KJVL"], legs: try Self.legs(), checkpoints: Self.checkpoints, course: try Self.course())
        #expect(points.map(\.name) == ["C81", "ROCKFORD", "KJVL", "KDLH"])
        #expect(points.map(\.kind) == [.departure, .checkpoint, .stop, .destination])
        #expect(points.map(\.field) == [true, false, true, true])
        // The fields' long names and positions are the course's; the
        // checkpoint's position is the chart read's.
        #expect(points[0].longName == "Campbell" && points[2].longName == "Southern Wisconsin Regional")
        #expect(points[1].lat == 42.27 && points[1].lon == -89.09)
        // The minutes to each point are the legs' added up, the 45 on the
        // ground at the stop counted after it.
        #expect(points[0].minutesFlown == 0)
        #expect(abs((points[1].minutesFlown ?? 0) - 17.3) < 1e-9)
        #expect(abs((points[2].minutesFlown ?? 0) - 28.8) < 1e-9)
        #expect(abs((points[3].minutesFlown ?? 0) - (28.8 + 45 + 164.1)) < 1e-9)
        // Each point carries the leg into it, for its row's figures.
        #expect(points[1].leg?.magneticHeadingDeg == 329 && points[3].leg?.eteMin == 164.1)
    }

    @Test func beforeTheNavLogTheRoutesFieldsAloneAreThePoints() throws {
        let points = StripData.points(dep: "C81", dest: "KDLH", stops: ["KJVL"], legs: [], checkpoints: [], course: try Self.course())
        #expect(points.map(\.name) == ["C81", "KJVL", "KDLH"])
        #expect(points.allSatisfy { $0.minutesFlown == nil && $0.field })
        #expect(StripData.points(dep: "", dest: "KDLH", stops: [], legs: [], checkpoints: [], course: nil).isEmpty)
    }

    @Test func theAirplaneIsPutOnTheLegItIsOnAndHowFarAlongIt() throws {
        let points = StripData.points(dep: "C81", dest: "KDLH", stops: ["KJVL"], legs: try Self.legs(), checkpoints: Self.checkpoints, course: try Self.course())
        // Nowhere known: nothing.
        #expect(StripData.positionAlong(points, fix: nil) == nil)
        // Just past Rockford on the way to Janesville: the second leg, near its start.
        let past = StripData.positionAlong(points, fix: CLLocationCoordinate2D(latitude: 42.33, longitude: -89.08))
        #expect(past?.leg == 1)
        #expect((past?.along ?? 1) < 0.3)
        // Half way from Janesville to Duluth: the third leg, about half along.
        let half = StripData.positionAlong(points, fix: CLLocationCoordinate2D(latitude: 44.73, longitude: -90.6))
        #expect(half?.leg == 2)
        #expect(abs((half?.along ?? 0) - 0.5) < 0.1)
        // Short of Rockford, on the way from C81: the first leg.
        let early = StripData.positionAlong(points, fix: CLLocationCoordinate2D(latitude: 42.3, longitude: -88.6))
        #expect(early?.leg == 0)
        #expect(StripData.nextPoint(points, position: early)?.name == "ROCKFORD")
        #expect(StripData.nextPoint(points, position: half)?.name == "KDLH")
    }

    @Test func aDurationIsWrittenAsTheWebWritesEveryOne() {
        #expect(StripData.duration(65) == "1h 5m")
        #expect(StripData.duration(45) == "45m")
        #expect(StripData.duration(180) == "3h")
        #expect(StripData.duration(0) == "0m")
        // The minutes rounded first: 119.6 is "2h", never "1h 60m".
        #expect(StripData.duration(119.6) == "2h")
        #expect(StripData.figures(eteMin: 165, fuelGal: 29.1) == "2h 45m · 29.1 gal")
        #expect(StripData.figures(eteMin: nil, fuelGal: nil) == "")
    }

    @Test func theHeadsLineIsTheRouteTheAirplaneTheAltitudeAsFLAndWhen() {
        #expect(StripData.routeName(dep: "C81", dest: "KDLH", stops: ["KJVL"]) == "C81 → KJVL → KDLH")
        #expect(StripData.routeName(dep: "KDLH", dest: "KDLH", stops: []) == "KDLH local")
        #expect(flightLevel(4500) == "FL-045")
        #expect(flightLevel(10500) == "FL-105")
        #expect(StripData.headLine(dep: "C81", dest: "KDLH", stops: ["KJVL"], airplane: "C172", cruiseFt: 4500, departAt: nil)
                == "C81 → KJVL → KDLH · C172 · FL-045 · leaving now")
        #expect(StripData.headLine(dep: "C81", dest: "KDLH", stops: [], airplane: "", cruiseFt: nil, departAt: nil) == "C81 → KDLH · leaving now")
    }

    @Test func theVerdictsTagAndTheHeadsLinesComeFromThePlannersAnswer() throws {
        #expect(StripData.tag("ok") == "Go" && StripData.tag("caution") == "Caution" && StripData.tag("stop") == "No-go")
        #expect(StripData.tag("pending") == nil && StripData.tag("unknown") == nil)
        let answer = try Self.decoder.decode(GoNoGoAnswer.self, from: Data(GoNoGoTests.answer.utf8))
        // The head wears the planner's line and at most three findings.
        #expect(StripData.tag(answer.line.finding) == "No-go")
        let lines = Glance.lines(answer)
        #expect(lines.count <= 3 && lines.count == 3)
        #expect(lines.allSatisfy { $0.words.count <= Glance.longest })
    }

    @Test func thePilotsInitialsAreTheirNamesElseTheirAddressesFirstLetter() {
        #expect(StripData.initials(name: "Asdaq Samir", email: "asdaq@example.com") == "AS")
        #expect(StripData.initials(name: "Cher", email: nil) == "CH")
        #expect(StripData.initials(name: "pilot@example.com", email: "pilot@example.com") == "P")
        #expect(StripData.initials(name: nil, email: "zed@example.com") == "Z")
        #expect(StripData.initials(name: nil, email: nil) == "")
    }

    @Test func theRadioChipsAreTheAtisTheTowerOrTheCtaf() {
        let towered = [
            Frequency(description: "ATIS", frequencyMhz: 124.1, type: "ATIS"),
            Frequency(description: "Tower", frequencyMhz: 118.3, type: "TWR"),
            Frequency(description: "CTAF", frequencyMhz: 118.3, type: "CTAF"),
        ]
        #expect(StripData.radioChips(towered, towered: true).map(\.label) == ["ATIS", "TOWER"])
        #expect(StripData.radioChips(towered, towered: true).map(\.words) == ["ATIS 124.1", "Tower 118.3"])
        let untowered = [
            Frequency(description: "AWOS-3", frequencyMhz: 119.025, type: "AWOS"),
            Frequency(description: "UNICOM/CTAF", frequencyMhz: 122.7, type: "UNICOM"),
        ]
        #expect(StripData.radioChips(untowered, towered: false).map(\.words) == ["AWOS 119.025", "CTAF 122.7"])
        // No frequency listed: MULTICOM's 122.9 (AC 90-66C 9.6).
        #expect(StripData.radioChips([], towered: false).map(\.words) == ["CTAF 122.9"])
    }

    @Test func theMiddleFoldsPastSixCheckpointsTheFirstThreeAndTheLastTwoKept() {
        func checkpoint(_ n: Int) -> StripPoint { StripPoint(key: "c\(n)", kind: .checkpoint, name: "CP\(n)") }
        let six = (1...6).map(checkpoint)
        #expect(StripData.folded(six, unfolded: false).hidden == 0)
        #expect(StripData.folded(six, unfolded: false).rows.count == 6)
        let eight = (1...8).map(checkpoint)
        let fold = StripData.folded(eight, unfolded: false)
        #expect(fold.hidden == 3)
        #expect(fold.rows.map { $0?.name } == ["CP1", "CP2", "CP3", nil, "CP7", "CP8"])
        #expect(StripData.folded(eight, unfolded: true).hidden == 0)
        // The numbers count every checkpoint, folded or not.
        let numbers = StripData.numbers(eight)
        #expect(numbers["c1"] == 1 && numbers["c8"] == 8)
    }

    @Test func theSuggestionsFollowWhetherARouteIsPlanned() {
        #expect(StripData.suggestions(routed: true, dest: "KDLH").prefix(2) == ["Brief me", "Weather at KDLH"])
        #expect(StripData.suggestions(routed: false, dest: "").first == "Nearest fuel")
        #expect(StripData.suggestions(routed: false, dest: "").allSatisfy { FieldCommands.read($0) != nil })
        #expect(StripData.suggestions(routed: true, dest: "KDLH").allSatisfy { FieldCommands.read($0) != nil })
    }

    @Test func theWeatherLineIsTheCategoryAndTheWindReported() {
        var metar = Metar()
        #expect(StripData.weatherLine(nil) == nil)
        #expect(StripData.weatherLine(metar) == nil)
        metar.flightCategory = "VFR"
        #expect(StripData.weatherLine(metar) == "VFR")
        metar.windDirTrueDeg = 90
        metar.windSpeedKt = 6
        #expect(StripData.weatherLine(metar)?.hasPrefix("VFR · wind ") == true)
    }
}
