import Foundation
import Testing
@testable import Wingtip

/// The Go / No-Go as the planner answers it (POST /api/go-no-go,
/// app.gonogo.schemas.GoNoGo), the question the app asks it in snake
/// case, and what the pilot sets kept on the phone.
struct GoNoGoTests {
    /// An answer shaped as the document's GoNoGo: a stop, a caution, the
    /// risk with a raised factor, the self checks, the loading and its
    /// balance.
    static let answer = #"""
    {"line":{"finding":"stop","words":"No-go as planned: Weight & balance"},
     "items":[
      {"key":"weather","label":"Weather","finding":"caution","detail":"IFR G-AIRMET along the route","tab":"enroute","section":"Adverse Conditions"},
      {"key":"airspace","label":"TFRs & special use","finding":"ok","detail":"None on the route","tab":"preflight","section":"TFRs & Special Use"},
      {"key":"altitude","label":"Altitude","finding":"ok","detail":"5,500 ft · Lowest plan","tab":"enroute","section":"Cruise Altitude"},
      {"key":"fuel","label":"Fuel","finding":"ok","detail":"Needs 30.2 gal with taxi and a 30 min reserve; 22.8 gal spare","tab":"preflight","section":"Fuel"},
      {"key":"runways","label":"Runways","finding":"unknown","detail":"Not worked out for this airplane","tab":"depart","section":"Takeoff"},
      {"key":"balance","label":"Weight & balance","finding":"stop","detail":"The baggage, 170 lb in all, is over its 120 lb","tab":"preflight","section":"Weight & Balance"},
      {"key":"risk","label":"Risk","finding":"caution","detail":"Raised · 8 points","tab":"preflight","section":"Risk Assessment"}],
     "risk":{"score":8,"level":"caution","line":"Raised · 8 points","words":"Bring it down where you can (a later time, a shorter leg, an instructor along), or talk it over.",
      "factors":[{"key":"hazards","label":"1 SIGMET or G-AIRMET along the route","why":"Adverse conditions","points":2,"stop":false,"finding":"caution"},
                 {"key":"stress","label":"Under stress: work, home or money","why":"IMSAFE: stress","points":3,"stop":false,"finding":"caution"}]},
     "self_checks":[{"key":"stress","group":"You","label":"Under stress: work, home or money","why":"IMSAFE: stress","points":3,"stop":false,"finding":"caution"},
                    {"key":"alcohol","group":"You","label":"Alcohol in the last 8 hours, or still feeling it","why":"91.17","points":0,"stop":true,"finding":"stop"}],
     "loading":{"source":"Cessna 172S POH","max_ramp_lb":2558,"max_takeoff_lb":2550,"max_landing_lb":2550,"sample_empty_weight_lb":1642,
      "sample_empty_moment_lb_in":62600,"stations":[{"name":"Front seats","arm_in":37,"max_lb":null},{"name":"Baggage area 1","arm_in":95,"max_lb":120}],
      "baggage_combined_max_lb":120,"fuel_arm_in":48,"fuel_max_gal":53,"fuel_lb_per_gal":6,"start_taxi_fuel_lb":8,"envelope":[[35,1500],[47.3,2550]]},
     "balance":{"load":{"empty_weight_lb":1642,"empty_arm_in":38.12,"stations_lb":[170,170],"fuel_gal":53},
      "takeoff":{"weight_lb":2296.4,"arm_in":41.234},"landing":{"weight_lb":2152.4,"arm_in":40.9},
      "problems":["The baggage, 170 lb in all, is over its 120 lb"]}}
    """#

    @Test func theAnswerReadsWithEveryFindingItsMarkAndWhereItOpens() throws {
        let answer = try Planner.snakeCase.decode(GoNoGoAnswer.self, from: Data(Self.answer.utf8))
        #expect(answer.line.finding == "stop" && answer.items.count == 7)
        #expect(answer.items.map(\.key) == ["weather", "airspace", "altitude", "fuel", "runways", "balance", "risk"])
        #expect(answer.items[0].section == "Adverse Conditions")
        #expect(answer.risk?.factors?.count == 2 && answer.risk?.level == "caution")
        #expect(answer.selfChecks?.last?.value == "No-go" && answer.selfChecks?.first?.value == "+3")
        #expect(answer.loading?.stations[1].maxLb == 120 && answer.loading?.stations[0].maxLb == nil)
        #expect(answer.balance?.load.stationsLb == [170, 170] && answer.balance?.problems?.count == 1)
        #expect(answer.balance?.takeoff.words == "2,296 lb · 41.2 in")
    }

    @Test func anAnswerWithNoRiskNoLoadingAndNoBalanceStillReads() throws {
        let json = #"{"line":{"finding":"pending","words":"Still checking: Risk"},"items":[{"key":"risk","label":"Risk","finding":"pending","detail":"Waiting on the briefing…","tab":"preflight","section":"Risk Assessment"}],"risk":null,"self_checks":[],"loading":null,"balance":null}"#
        let answer = try Planner.snakeCase.decode(GoNoGoAnswer.self, from: Data(json.utf8))
        #expect(answer.risk == nil && answer.loading == nil && answer.balance == nil)
    }

    @Test func theQuestionGoesInTheDocumentsSnakeCaseWithOnlyWhatIsSet() throws {
        var ask = GoNoGoAsk(dep: "C81", dest: "KDLH", stops: "KMSN", aircraft: "c172", day: "2026-10-25")
        ask.minimums.ceilingFt = 3000
        ask.load = AirplaneLoad(emptyWeightLb: 1642, emptyArmIn: 38.12, stationsLb: [170, 0, 0, 0], fuelGal: 40)
        ask.ticked = ["stress"]
        ask.cruiseTasKt = 118
        ask.currency = Currency(totalHours: 240, flights: 120, dayPassengersUntil: "2026-12-01")
        let data = try Planner.snakeEncoder.encode(ask)
        let body = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(body["dep"] as? String == "C81" && body["stops"] as? String == "KMSN")
        #expect(body["altitude_choice"] as? String == "fastest" && body["altitude_nearest"] as? Bool == false)
        #expect(body["cruise_tas_kt"] as? Double == 118 && body["fuel_burn_gph"] == nil)
        let minimums = try #require(body["minimums"] as? [String: Any])
        #expect(minimums["ceiling_ft"] as? Double == 3000 && minimums["visibility_sm"] == nil)
        let load = try #require(body["load"] as? [String: Any])
        #expect(load["stations_lb"] as? [Double] == [170, 0, 0, 0] && load["empty_arm_in"] as? Double == 38.12)
        let currency = try #require(body["currency"] as? [String: Any])
        #expect(currency["day_passengers_until"] as? String == "2026-12-01" && currency["total_hours"] as? Double == 240)
        #expect(body["ticked"] as? [String] == ["stress"] && body["day"] as? String == "2026-10-25")
    }

    @Test func theDayIsThePilotsOwnCalendarDay() throws {
        // 03:00Z on 6 October is still the 5th in Chicago.
        let at = try #require(ISO8601DateFormatter().date(from: "2026-10-06T03:00:00Z"))
        #expect(GoNoGoAsk.day(at, in: TimeZone(identifier: "America/Chicago")!) == "2026-10-05")
        #expect(GoNoGoAsk.day(at, in: TimeZone(identifier: "UTC")!) == "2026-10-06")
    }

    @Test func theMinimumsMenusAreTheWebAppsChoicesInItsWords() {
        #expect(PersonalMinimums.Key.ceilingFt.choices == [1000, 1500, 2000, 2500, 3000, 4000, 5000])
        #expect(PersonalMinimums.Key.ceilingFt.words(1500) == "1,500 ft")
        #expect(PersonalMinimums.Key.visibilitySm.words(5) == "5 sm")
        #expect(PersonalMinimums.Key.windKt.title == "Wind, with gusts" && PersonalMinimums.Key.windKt.words(25) == "25 kt")
        var minimums = PersonalMinimums()
        minimums[.crosswindKt] = 12
        #expect(minimums.crosswindKt == 12 && minimums[.ceilingFt] == nil)
    }

    @MainActor @Test func theMinimumsAndEachAirplanesLoadAreKeptOnThePhone() throws {
        let store = try #require(UserDefaults(suiteName: "GoNoGoTests"))
        store.removePersistentDomain(forName: "GoNoGoTests")
        let verdict = Verdict(store: store)
        verdict.setMinimum(.visibilitySm, 5)
        verdict.setLoad(AirplaneLoad(emptyWeightLb: 1700, emptyArmIn: 39, stationsLb: [180], fuelGal: 30), for: "c172")
        verdict.tick("stress", true)
        let again = Verdict(store: store)
        #expect(again.minimums.visibilitySm == 5)
        #expect(again.load(for: "c172")?.emptyWeightLb == 1700 && again.load(for: "pa28") == nil)
        // The ticks are about the pilot today: for the session only.
        #expect(again.ticked.isEmpty && verdict.ticked == ["stress"])
        store.removePersistentDomain(forName: "GoNoGoTests")
    }

    @MainActor @Test func theQuestionIsThePlanAsTheNavLogWasAskedIt() {
        let store = UserDefaults(suiteName: "GoNoGoTests.plan")!
        store.removePersistentDomain(forName: "GoNoGoTests.plan")
        let plan = Plan()
        plan.dep = "C81"; plan.dest = "KDLH"; plan.stops = ["KMSN"]
        plan.ownAltitudeFt = 5500; plan.ownAltitudeLegal = true; plan.altitudeChoice = nil
        let verdict = Verdict(store: store)
        verdict.setMinimum(.windKt, 20)
        let ask = verdict.ask(for: plan)
        #expect(ask.stops == "KMSN" && ask.aircraft == "c172" && ask.altitudeFt == 5500 && ask.altitudeNearest)
        #expect(ask.altitudeChoice == "fastest" && ask.minimums.windKt == 20 && ask.load == nil)
        store.removePersistentDomain(forName: "GoNoGoTests.plan")
    }

    @Test func eachFindingHasItsMarkAndOpensWhereTheBriefSaysIt() throws {
        let answer = try Planner.snakeCase.decode(GoNoGoAnswer.self, from: Data(Self.answer.utf8))
        let targets = answer.items.map { VerdictTarget.of($0) }
        #expect(targets == [.section(VerdictTarget.weatherAnchor), .section(VerdictTarget.airspaceAnchor), nil, nil, nil, .loading, .risk])
        #expect(FindingStyle.symbol("stop") == "xmark.octagon.fill" && FindingStyle.symbol("ok") == "checkmark.circle.fill")
        #expect(FindingStyle.symbol("pending") != FindingStyle.symbol("unknown"))
    }
}

struct OwnAirplaneAskTests {
    /// The gateway's record goes to the planner in the planner's names,
    /// open squawks only.
    @Test func theRecordsInThePlannersNames() throws {
        let json = """
        {"id":7,"tailNumber":"N3429J","typeDesignator":"P28A","cruiseTasKt":108,"fuelBurnGph":8.4,
         "inspections":{"annualOn":"2026-03-02","annualGoodThrough":"2027-03-31","hoursNow":4210.5,"hundredHourDueAtHours":4280},
         "openSquawks":[{"id":1,"reportedOn":"2026-10-01","text":"Nav light out","inoperative":true,"deferredFor":"91.213(d)"},
                        {"id":2,"reportedOn":"2026-09-01","text":"Door seal","inoperative":false,"fixedOn":"2026-09-20"}],
         "vorCheck":{"checkedOn":"2026-10-10","errorDeg":2,"goodThrough":"2026-11-09","kind":"vot","limitDeg":4,"withinLimit":true}}
        """
        let record = try JSONDecoder().decode(OwnAircraftRecord.self, from: Data(json.utf8))
        let body = try JSONSerialization.jsonObject(with: Planner.snakeEncoder.encode(OwnAirplaneAsk(record))) as! [String: Any]
        let inspections = body["inspections"] as! [String: Any]
        #expect(inspections["annual_good_through"] as? String == "2027-03-31")
        #expect(inspections["hundred_hour_due_at_hours"] as? Double == 4280)
        let squawks = body["squawks"] as! [[String: Any]]
        #expect(squawks.count == 1 && squawks[0]["deferred_for"] as? String == "91.213(d)")
        #expect((body["vor_check"] as! [String: Any])["within_limit"] as? Bool == true)
    }
}
