import CoreLocation
import Foundation
import Testing
@testable import Wingtip

/// The nav log's stream decoded line by line, as the planner sends it.
struct NavLogTests {
    @Test func eachKindOfLineIsRead() throws {
        let stage = #"{"type":"stage","detail":"Planning altitudes…"}"#
        let leg = #"{"type":"leg","from":"C81","to":"KDLH","distance_nm":30.0,"altitude_ft":4500.0,"true_course_deg":330.0,"wind":{"direction_deg":250.0,"speed_kt":12.0},"wca_deg":-4.0,"true_heading_deg":326.0,"magnetic_variation_deg":-3.0,"magnetic_heading_deg":329.0,"groundspeed_kt":104.0,"ete_min":17.3,"fuel_gal":2.4,"tas_kt":110.0,"fuel_burn_gph":8.5,"power_pct":75.0,"density_altitude_ft":5200.0}"#
        let done = #"{"type":"done","totals":{"distance_nm":323.5,"ete_min":165.0,"fuel_gal":29.1,"fuel_margin_gal":12.2,"reserve_min":30.0,"night":false}}"#
        let error = #"{"type":"error","detail":"No legal VFR cruising altitude","brief":"Ceiling 11,700 ft","reasons":["The terrain needs 12,500 ft."],"advice":"Route around it.","retry":false}"#
        #expect(try NavLog.decode(line: Data(stage.utf8)) == .stage("Planning altitudes…"))
        guard case .leg(let l)? = try NavLog.decode(line: Data(leg.utf8)) else { Issue.record("not a leg"); return }
        #expect(l.to == "KDLH" && l.magneticHeadingDeg == 329 && l.eteMin == 17.3 && l.wind?.speedKt == 12)
        guard case .done(let t)? = try NavLog.decode(line: Data(done.utf8)) else { Issue.record("not done"); return }
        #expect(t.fuelMarginGal == 12.2 && t.night == false)
        guard case .error(let e)? = try NavLog.decode(line: Data(error.utf8)) else { Issue.record("not an error"); return }
        #expect(e.brief == "Ceiling 11,700 ft" && e.reasons?.count == 1)
    }

    @Test func aLineOfAKindNotYetUsedIsSkipped() throws {
        #expect(try NavLog.decode(line: Data(#"{"type":"checkpoint","ident":"X"}"#.utf8)) == nil)
    }

    @Test func theCourseLineBecomesCoordinates() throws {
        let json = #"{"departure":{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07},"destination":{"ident":"KDLH","name":"Duluth","lat":46.84,"lon":-92.19},"distance_nm":323.5,"bearing_deg":325.0,"course_line":[[42.32,-88.07],[44.5,-90.0],[46.84,-92.19]]}"#
        let course = try Planner.snakeCase.decode(Course.self, from: Data(json.utf8))
        #expect(course.coordinates.count == 3 && course.coordinates[1].latitude == 44.5 && (course.stops ?? []).isEmpty)
    }

    @Test func minutesReadAsHoursAndMinutes() {
        #expect(hoursMinutes(165) == "2h 45m")
        #expect(hoursMinutes(5.4) == "0h 05m")
    }
}

/// The altitude line whole, and the owner's FL-style figure.
struct AltitudeTests {
    @Test func theAltitudeLineCarriesThePlansFiguresAndCautions() throws {
        let json = #"{"type":"altitude","flown":"custom","altitude_ft":15500.0,"options":[{"kind":"fastest","steps":[{"from":"KLAX","to":"KBDL","altitude_ft":9500.0,"distance_nm":2100.0}],"ete_min":1100.0,"fuel_gal":150.0,"climb_penalty_min":2.0,"tailwind_kt":5.0,"unflyable_legs":0,"legs_without_wind":0,"needs_oxygen":false}],"altitude_figures":[{"altitude_ft":9500.0,"ete_min":1100.0,"fuel_gal":150.0,"tailwind_kt":5.0,"everywhere":true}],"cautions":[{"from_ident":"KLAX","to_ident":"KBDL","altitude_ft":15500.0,"reasons":["Over the aircraft's 10,950 ft service ceiling"]}],"altitude_selection":{"recommended_ft":null,"candidates_ft":[],"floor_ft":13600.0,"service_ceiling_ft":10950.0,"rules":"vfr"},"aircraft":{"name":"pa28140"}}"#
        guard case .altitude(let a)? = try NavLog.decode(line: Data(json.utf8)) else { Issue.record("not an altitude"); return }
        #expect(a.altitudeFt == 15500 && a.options[0].altitudeFt == 9500 && a.cautions[0].reasons.count == 1)
        #expect(a.altitudeSelection?.serviceCeilingFt == 10950 && a.altitudeFigures.count == 1)
    }

    @Test func altitudesReadAsTheOwnersFlightLevels() {
        #expect(flightLevel(6500) == "FL065")
        #expect(flightLevel(15500) == "FL155")
    }
}

/// The planner's fuel stops and ways round, put into the route.
struct RouteEditTests {
    @MainActor @Test func theWholeChainGoesInBeforeTheFlightsDestination() {
        let plan = Plan()
        plan.dep = "KELP"; plan.dest = "KBDL"; plan.stops = ["KUCP"]
        let stop = { (ident: String) in FuelStop(ident: ident, name: ident, city: "", lat: 0, lon: 0, fromNm: 0, addedNm: 0, landsWithGal: 7, minutes: 0, fuelTypes: "100LL", runwayFt: 4000) }
        plan.addFuelStops(FuelStopSuggestion(departure: "KELP", destination: "KUCP", usableGal: 36, stops: [stop("KPPA"), stop("KFSK")]))
        #expect(plan.stops == ["KPPA", "KFSK", "KUCP"])
        plan.goRound(Detour(ident: "KWHP", kind: "Around the high ground", addedNm: 157, stopIndex: 0, via: ["KWHP", "KGCN"]))
        #expect(plan.stops == ["KWHP", "KGCN", "KPPA", "KFSK", "KUCP"])
    }
}

/// The last plan kept on the device and read back whole.
struct KeptTests {
    @Test func aPlanKeptComesBackAsItWas() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "kept-\(UUID().uuidString).json")
        let course = try Planner.snakeCase.decode(Course.self, from: Data(#"{"departure":{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07},"destination":{"ident":"KDLH","name":"Duluth","lat":46.84,"lon":-92.19},"distance_nm":323.5,"bearing_deg":325.0,"course_line":[[42.32,-88.07],[46.84,-92.19]]}"#.utf8))
        let kept = Kept(dep: "C81", dest: "KDLH", stops: [], aircraft: "c172", course: course, totals: Totals(distanceNm: 323.5, eteMin: 165), plannedAt: Date(timeIntervalSince1970: 1_800_000_000))
        kept.save(to: file)
        #expect(Kept.load(from: file) == kept)
        Kept.forget(at: file)
        #expect(Kept.load(from: file) == nil)
    }
}

/// Flying the route from where the airplane is: along the line, what is
/// left, and the fuel burnt.
struct FlightTests {
    @Test func aPositionHalfWayAlongALegIsHalfWayAlong() {
        let line = [CLLocationCoordinate2D(latitude: 42.0, longitude: -88.0), CLLocationCoordinate2D(latitude: 43.0, longitude: -88.0)]
        let left = Flight.along(CLLocationCoordinate2D(latitude: 42.5, longitude: -88.05), line: line)!
        #expect(abs(left.alongNm - 30) < 0.5 && abs(left.totalNm - 60) < 0.5 && abs(left.leftNm - 30) < 0.5)
        #expect(Flight.off(CLLocationCoordinate2D(latitude: 42.5, longitude: -88.05), line: line) < 2.5)
        #expect(Flight.along(CLLocationCoordinate2D(latitude: 42.5, longitude: -88.0), line: [line[0]]) == nil)
    }

    @Test func fuelBurntIsEachLegsShareOfItsMiles() {
        let leg = { (to: String, nm: Double, gal: Double) in Leg(from: "A", to: to, distanceNm: nm, altitudeFt: 4500, trueCourseDeg: 0, magneticHeadingDeg: 0, groundspeedKt: 100, eteMin: nm / 100 * 60, fuelGal: gal, tasKt: 100) }
        let legs = [leg("B", 10, 2.0), leg("C", 20, 4.0)]
        #expect(abs(Flight.burnt(legs: legs, alongNm: 5) - 1.0) < 0.001)
        #expect(abs(Flight.burnt(legs: legs, alongNm: 20) - 4.0) < 0.001)
        #expect(abs(Flight.burnt(legs: legs, alongNm: 60) - 6.0) < 0.001)
    }
}

/// A procedure picked, as the planner's query takes it.
struct ProcedureTests {
    @Test func aPickIsIdentIdAndItsTransition() {
        #expect(ProcedurePick(ident: "KDLH", id: "I09", kind: "approach", name: "ILS 09").param == "KDLH:I09")
        #expect(ProcedurePick(ident: "KORD", id: "WYNDE3", kind: "arrival", name: "WYNDE THREE", transition: "ZZIPR").param == "KORD:WYNDE3:ZZIPR")
    }

    @MainActor @Test func onePickPerFieldAndKind() {
        let plan = Plan()
        plan.dep = "C81"; plan.dest = "KDLH"
        plan.procedures = [ProcedurePick(ident: "KDLH", id: "I09", kind: "approach", name: "ILS 09")]
        plan.procedures.removeAll { $0.ident == "KDLH" && $0.kind == "approach" }
        plan.procedures.append(ProcedurePick(ident: "KDLH", id: "R27", kind: "approach", name: "RNAV 27"))
        #expect(plan.procedures.map(\.id) == ["R27"])
    }
}

/// The dry run's airplane along the plan.
struct DryRunTests {
    @MainActor @Test func theAirplaneIsPlacedByTheLegsMinutes() {
        let run = DryRun()
        let line = [CLLocationCoordinate2D(latitude: 42.0, longitude: -88.0), CLLocationCoordinate2D(latitude: 43.0, longitude: -88.0)]
        let leg = Leg(from: "A", to: "B", distanceNm: 60, altitudeFt: 4500, trueCourseDeg: 0, magneticHeadingDeg: 0, groundspeedKt: 120, eteMin: 30, fuelGal: 4, tasKt: 110)
        run.start(line: line, legs: [leg])
        #expect(run.running && run.fix?.groundspeedKt == 120 && abs((run.fix?.coordinate.latitude ?? 0) - 42.0) < 0.01)
        run.stop()
        #expect(!run.running && run.fix == nil)
    }
}
