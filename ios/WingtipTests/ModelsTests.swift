import Foundation
import Testing
import UIKit
@testable import Wingtip

/// The planner's answers as the document spells them, read into the
/// app's models: snake case, nullables, and `private`, which Swift keeps
/// for itself.
struct ModelsTests {
    @Test func aChartInfoWithNoCDNReadsAsThePlannersOwnTiles() throws {
        let json = #"{"chart_cycle":"09-03-2026","chart_revision":1,"chart_tiles_base":null,"chart_layers":[{"kind":"sec","label":"Sectional","base":true,"min_zoom":5,"max_zoom":12,"over":[]}],"min_zoom":5,"max_zoom":12}"#
        let info = try Planner.snakeCase.decode(ChartInfo.self, from: Data(json.utf8))
        #expect(info.chartTilesBase == nil && info.chartLayers[0].kind == "sec" && info.chartRevision == 1)
        // Kept and read back by the app's own encoder.
        let again = try JSONDecoder().decode(ChartInfo.self, from: JSONEncoder().encode(info))
        #expect(again == info)
    }

    @Test func aFieldInViewWithAndWithoutAReport() throws {
        let json = #"{"airports":[{"ident":"KDLH","name":"Duluth Intl","lat":46.84,"lon":-92.19,"kind":"large","flight_category":"MVFR","airspace_class":"D","military":null,"private":false},{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07,"kind":"small","flight_category":null,"airspace_class":null,"military":null,"private":true}]}"#
        struct Answer: Decodable { let airports: [AirportPin] }
        let pins = try Planner.snakeCase.decode(Answer.self, from: Data(json.utf8)).airports
        #expect(pins[0].flightCategory == "MVFR" && pins[0].airspaceClass == "D" && pins[0].isPrivate == false)
        #expect(pins[1].flightCategory == nil && pins[1].isPrivate == true)
    }

    @Test func aCardWithAMetarAndARunwaysWind() throws {
        let json = #"{"ident":"KDLH","name":"Duluth Intl","lat":46.84,"lon":-92.19,"kind":"large","towered":true,"elevation_ft":1428.0,"municipality":"Duluth","region":"MN","airspace_class":"D","runways":[{"ends":"09/27","length_ft":10162,"width_ft":150,"surface":"ASPH","lighted":true,"closed":false,"wind":{"end":"27","headwind_kt":8.0,"crosswind_kt":3.0,"in_use":true}}],"frequencies":[{"type":"TWR","description":"Tower","frequency_mhz":118.3}],"metar":{"raw":"KDLH 241553Z 25012KT 10SM BKN025 08/02 A3005","flight_category":"MVFR","wind_dir_true_deg":250.0,"wind_speed_kt":12.0,"visibility_sm":10.0,"ceiling_ft":2500.0,"temp_c":8.0,"altimeter_in_hg":30.05},"pattern":{"agl_ft":1000.0,"altitude_ft":2400.0,"published":false}}"#
        let place = try Planner.snakeCase.decode(AirportPlace.self, from: Data(json.utf8))
        #expect(place.runways[0].wind?.end == "27" && place.runways[0].lengthFt == 10162)
        #expect(place.metar?.ceilingFt == 2500 && place.metar?.raw?.hasPrefix("KDLH") == true)
        #expect(place.frequencies[0].frequencyMhz == 118.3 && place.pattern?.altitudeFt == 2400)
    }
}

/// The checkpoint's colour steps, as the web app's scoreColor bands them.
struct CheckpointColourTests {
    @Test func theScoreBandsAreTheWebAppsFiveSteps() {
        let steps = [2.9, 3.0, 3.5, 4.0, 4.5].map { CheckpointAnnotation.colour(for: $0) }
        #expect(Set(steps.map { $0.description }).count == 5)
        #expect(CheckpointAnnotation.colour(for: 4.49) == CheckpointAnnotation.colour(for: 4.0))
        #expect(CheckpointAnnotation.ink(for: 3.4) != CheckpointAnnotation.ink(for: 3.5))
    }
}

/// The briefing as the planner sends it: reports kept as sent, a station
/// with no report, the planner's own "VFR flight not recommended".
struct BriefingTests {
    @Test func aBriefingWithAMissingReportAndANoGo() throws {
        let json = #"{"hazards":[{"type":"SIGMET","hazard":"CONVECTIVE","raw":"WSUS31 KKCI 241455","altitude_low_ft":null,"altitude_high_ft":45000.0}],"forecast":{"min_ceiling_ft":800.0,"min_visibility_sm":2.0,"stations":[{"ident":"KDLH","raw":"TAF KDLH 241130Z"}]},"metars":{"C81":null,"KDLH":{"raw":"KDLH 241553Z 25012KT 2SM BR OVC008","flight_category":"IFR"}},"airports":{},"gairmets":[],"pireps":[],"tfrs":[{"notam_id":"6/1234","along_track_nm":40.0,"crosses":true,"active_now":false,"title":"Stadium"}],"vfr_not_recommended":["IFR at the destination: ceiling 800 ft, visibility 2 SM"],"weather_unavailable":[]}"#
        let briefing = try Planner.snakeCase.decode(Briefing.self, from: Data(json.utf8))
        #expect(briefing.vfrNotRecommended?.count == 1 && briefing.hazards[0].hazard == "CONVECTIVE")
        #expect(briefing.metars["KDLH"]??.flightCategory == "IFR")
        // A station with no report: its key there, its value nothing.
        #expect(briefing.metars["C81"].flatMap { $0 } == nil && briefing.metars.count == 2)
        #expect(briefing.tfrs?.first?.crosses == true && briefing.forecast?.minCeilingFt == 800)
    }
}

/// The ways to fly a route, as the planner offers them.
struct RoutesTests {
    @Test func theOptionsCarryTheirStopsPathAndWhatTheyCross() throws {
        let json = #"{"options":[{"kind":"weather","kinds":["weather"],"title":"Round the storms by KEAU","stops":["KEAU"],"fuel":["KEAU"],"path":[[42.3,-88.1],[44.9,-91.5],[46.8,-92.2]],"distance_nm":340.0,"air_min":180.0,"ground_min":30.0,"fuel_gal":31.0,"landings":1,"crosses":[],"marginal":[0],"tail_kt":-3.0,"floor_ft":3500}],"own":{"kind":"own","kinds":[],"title":"Your route","stops":[],"fuel":[],"path":[[42.3,-88.1],[46.8,-92.2]],"distance_nm":323.5,"air_min":165.0,"ground_min":0.0,"fuel_gal":29.0,"landings":0,"crosses":[0],"marginal":[]},"direct":[0],"ends":[],"hazards":[{"kind":"storm","name":"Thunderstorms near KMSP"}],"unchecked":["TFRs"]}"#
        let routes = try Planner.snakeCase.decode(RouteOptions.self, from: Data(json.utf8))
        #expect(routes.options[0].stops == ["KEAU"] && routes.options[0].path.count == 3 && routes.options[0].marginal == [0])
        #expect(routes.own?.crosses == [0] && routes.hazards[0].name == "Thunderstorms near KMSP" && routes.unchecked == ["TFRs"])
    }
}

/// An airplane by its N-number, as the web app's aircraftChoice.test.ts
/// pins it: the N-number's shape, and the type's profile by the
/// registry's make, model and year.
struct RegisteredTests {
    @Test func anNNumberIsToldFromOtherWordsByItsShape() {
        #expect(["N3429J", "N1", "N12345", "N172SP"].allSatisfy { Registered.isNNumber($0) })
        #expect(!["N0123", "N123456", "C172", "KDLH"].contains { Registered.isNNumber($0) })
    }

    @Test func aRegisteredTypeFliesOnItsProfile() {
        #expect(Registered.profile(manufacturer: "Cessna", model: "172S", year: nil) == "c172")
        #expect(Registered.profile(manufacturer: "Piper", model: "PA-28-181", year: nil) == "pa28")
        #expect(Registered.profile(manufacturer: "Piper", model: "PA-28-140", year: 1971) == "pa28140")
        #expect(Registered.profile(manufacturer: "Piper", model: "PA-28-140", year: 1975) == "pa28140cruiser")
        #expect(Registered.profile(manufacturer: "Piper", model: "PA-28-140", year: nil) == "pa28140cruiser")
        #expect(Registered.profile(manufacturer: "Cirrus Design Corp", model: "SR22", year: nil) == "sr22")
        #expect(Registered.profile(manufacturer: "Beech", model: "A36", year: nil) == nil)
        #expect(Registered.profile(manufacturer: "Cessna", model: "T182T", year: nil) == nil)
    }

    @Test func theFiguresQueryCarriesOnlyWhatIsSet() {
        let q = Figures(cruiseTasKt: 115, usableFuelGal: 36).query.compactMapValues { $0 }
        #expect(q == ["cruise_tas_kt": "115.0", "usable_fuel_gal": "36.0"])
    }
}
