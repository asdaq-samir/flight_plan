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

/// The pilot's things on the gateway, as it sends them: camel case,
/// dates as strings.
struct PilotTests {
    @Test func aSavedFlightAndTheCurrencyRead() throws {
        let flights = try JSONDecoder().decode([SavedFlight].self, from: Data(#"[{"id":7,"departureIdent":"C81","destinationIdent":"KDLH","stops":["KEAU"],"aircraftTailNumber":"N654FL","cruiseAltitudeFt":6500,"totalDistanceNm":330.0,"totalEteMin":170.0,"totalFuelGal":29.5,"plannedFor":null,"createdAt":"2026-10-24T10:00:00Z","altitudes":null,"picks":null,"risk":null}]"#.utf8))
        #expect(flights[0].stops == ["KEAU"] && flights[0].cruiseAltitudeFt == 6500)
        let currency = try JSONDecoder().decode(Currency.self, from: Data(#"{"totalHours":152.3,"nightHours":12.0,"crossCountryHours":40.5,"flights":30,"landings":120,"dayPassengersUntil":"2026-12-01","nightPassengersUntil":null,"instrumentCurrentUntil":null,"ipcNeededAfter":null,"flightReviewOn":"2025-06-01","flightReviewUntil":"2027-06-30","medicalExpiresOn":"2027-01-31","approachesInWindow":0,"holdingInWindow":false,"trackingInWindow":false}"#.utf8))
        #expect(currency.dayPassengersUntil == "2026-12-01" && currency.nightPassengersUntil == nil && currency.flightReviewUntil == "2027-06-30")
    }

    @MainActor @Test func thePlanSavesItsRouteAndLegs() {
        let plan = Plan()
        plan.dep = "C81"; plan.dest = "KDLH"
        #expect(plan.saved() == nil)
    }
}

/// The handbook page's figures, as the web app's handbookText.test.ts
/// pins them, the parser kept the same.
struct HandbookTests {
    @Test func aPipersFiguresInKnotsWhereItPrintsMph() {
        let page = """
        CHEROKEE 140 "D" SECTION I
        SPECIFICATIONS
        PERFORMANCE
        GROSS WEIGHT 2150
        Take-off Run (ft) (flaps up) 800
        Best Rate of Climb Speed (mph) 85
        Rate of Climb (ft per min) 660
        Service Ceiling (ft) 14,300
        Absolute Ceiling 16,800
        Top Speed (mph) 139 (142*)
        Cruising Speed (75% power, sea
        level) (mph) 121 (124*)
        Optimum Cruising Speed (75%
        power, 7000 ft, mph) 132 (135*)
        Fuel Consumption (gal per hr 75%) 8.4
        Fuel Consumption (gal per hr 50%) 5.6
        """
        let f = Handbook.figures(of: page)
        #expect(f.serviceCeilingFt?.value == 14300 && f.climbTasKt?.value == 74 && f.cruiseTasKt?.value == 115 && f.cruisePowerPct?.value == 75 && f.fuelBurnGph?.value == 8.4)
        #expect(f.serviceCeilingFt?.words == "Service Ceiling (ft) 14,300")
    }

    @Test func aCessnasWithTheUsableFuelAndNoVno() {
        let page = """
        Maximum Structural Cruising Speed (Vno) 129 KTS
        Cruise, 75% Power at 8000 Ft ........ 122 KTS (140 MPH)
        SERVICE CEILING ........ 13.500 FT
        FUEL CAPACITY: Total 56 GAL. Usable 53 GAL.
        Fuel flow 75% 8.4 gph 65% 7.0 gph
        """
        let f = Handbook.figures(of: page)
        #expect(f.cruiseTasKt?.value == 122 && f.cruisePowerPct?.value == 75 && f.serviceCeilingFt?.value == 13500 && f.usableFuelGal?.value == 53 && f.fuelBurnGph?.value == 8.4)
        #expect(Handbook.figures(of: "NORMAL PROCEDURES\nBefore starting engine, check fuel selector.").isEmpty)
    }
}

struct TrainingTests {
    /// The gateway's TrainingDto, with the fields the page does not show.
    @Test func theTrainingReadsAsTheGatewaySendsIt() throws {
        let json = """
        {"fullName":"Sam Pilot","kinds":[],"knowledgeTestCodes":[],"endorsements":[],
         "instructors":[{"id":3,"email":"cfi@example.com","name":"Ann CFI","certificate":"1234567CFI","accepted":true,"askedAt":"2026-10-13T10:00:00Z"}],
         "signed":[{"id":9,"code":"A.6","text":"I certify that…","signedOn":"2026-10-14","until":"2026-11-13","voided":false,"digest":"x","signature":"y","studentName":"Sam Pilot","fields":{}}],
         "reviews":[{"id":1,"flightOn":"2026-10-20","makeModel":"PA-28-140","checks":[{"label":"Route","detail":"KRZL to KLAF","rule":"61.93(c)(3)","met":true}],
                     "answeredAt":null,"askedAt":"2026-10-19T10:00:00Z","declinedNote":null,"instructorName":"Ann CFI","note":null,"studentId":null,"studentName":"Sam Pilot","endorsement":null,"flight":null}],
         "experience":[{"key":"xc","label":"Cross-country solo","rule":"61.109(a)(5)","unit":"h","have":2.5,"need":5,"met":false}]}
        """
        let training = try JSONDecoder().decode(Training.self, from: Data(json.utf8))
        #expect(training.instructors.first?.accepted == true)
        #expect(training.signed.first?.until == "2026-11-13")
        #expect(training.reviews.first?.checks.first?.met == true)
        #expect(training.experience.first?.words == "2.5 of 5 h")
    }
}
