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
        let json = #"{"departure":{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07},"destination":{"ident":"KDLH","name":"Duluth","lat":46.84,"lon":-92.19},"distance_nm":323.5,"bearing_deg":325.0,"course_line":[[42.32,-88.07],[44.5,-90.0],[46.84,-92.19]],"chart_cycle":"09-03-2026","chart_layers":[],"min_zoom":5,"max_zoom":12}"#
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
        #expect(flightLevel(6500) == "FL-065")
        #expect(flightLevel(15500) == "FL-155")
    }
}

/// The planner's ways round, put into the route.
struct RouteEditTests {
    @MainActor @Test func theWayRoundGoesInBeforeTheStopItIsFor() {
        let plan = Plan()
        plan.dep = "KELP"; plan.dest = "KBDL"; plan.stops = ["KPPA", "KFSK", "KUCP"]
        plan.goRound(Detour(ident: "KWHP", kind: "Around the high ground", addedNm: 157, stopIndex: 0, via: ["KWHP", "KGCN"]))
        #expect(plan.stops == ["KWHP", "KGCN", "KPPA", "KFSK", "KUCP"])
    }
}

/// The last plan kept on the device and read back whole.
struct KeptTests {
    @Test func aPlanKeptComesBackAsItWas() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "kept-\(UUID().uuidString).json")
        let course = try Planner.snakeCase.decode(Course.self, from: Data(#"{"departure":{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07},"destination":{"ident":"KDLH","name":"Duluth","lat":46.84,"lon":-92.19},"distance_nm":323.5,"bearing_deg":325.0,"course_line":[[42.32,-88.07],[46.84,-92.19]],"chart_cycle":"09-03-2026","chart_layers":[],"min_zoom":5,"max_zoom":12}"#.utf8))
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

/// The dry run's airplane along the plan, flown by the engine's `dry_run`.
struct DryRunTests {
    @MainActor @Test func theAirplaneFliesTheLegInItsMinutes() throws {
        let a = CourseEnd(elevationFt: 700, ident: "A", lat: 42.0, lon: -88.0, name: "A")
        let b = CourseEnd(elevationFt: 700, ident: "B", lat: 43.0, lon: -88.0, name: "B")
        let course = Course(bearingDeg: 0, chartCycle: "", chartLayers: [], courseLine: [[42.0, -88.0], [43.0, -88.0]], departure: a, destination: b, distanceNm: 60, maxZoom: 0, minZoom: 0)
        let leg = Leg(from: "A", to: "B", distanceNm: 60, altitudeFt: 4500, trueCourseDeg: 0, magneticHeadingDeg: 0, groundspeedKt: 120, eteMin: 30, fuelGal: 4, tasKt: 110)
        // Its 30 minutes, at its 120 kt, from A to B, landed there; no
        // height where the plan has no climb in it.
        let points = try #require(DryRun.run(course: course, checkpoints: [], legs: [leg]))
        #expect(points.count >= 2 && abs((points.last?.t ?? 0) - 1800) < 1)
        #expect(points.dropLast().allSatisfy { $0.gsKt == 120 } && points.last?.gsKt == 0)
        #expect(abs((points.last?.lat ?? 0) - 43.0) < 0.01 && points.allSatisfy { $0.altFt == nil })
        // With its top of climb and of descent, the climb at the climb's
        // speed to 4,500 ft, cruise, and down to the pattern and the field.
        var climbing = leg
        climbing.climbMin = 6
        climbing.toc = Leg.TopOfClimb(alongNm: 10, eteMin: 6, fuelGal: 1.2, altitudeFt: 4500, lat: 42.1667, lon: -88, tasKt: 80, groundspeedKt: 85)
        climbing.tod = Leg.TopOfDescent(alongNm: 50, eteMin: 25, fuelGal: 3.4, altitudeFt: 4500, lat: 42.8333, lon: -88, toFt: 1700, pattern: true)
        let rows = try #require(DryRun.rows(course: course, checkpoints: [], legs: [climbing]))
        #expect(rows.map(\.kind) == ["departure", "toc", "tod", "destination"])
        #expect(rows[1].part?.distanceNm == 10 && rows[1].part?.groundspeedKt == 85 && rows[3].part?.eteMin == 5)
        let flown = try #require(DryRun.run(course: course, checkpoints: [], legs: [climbing]))
        #expect(flown.first?.altFt == 700 && flown.first?.gsKt == 85)
        #expect(flown.contains { $0.altFt == 4500 && $0.gsKt == 120 } && flown.last?.altFt == 700)
        // A row a leg, or no run: a checkpoint with no leg to it is not one.
        let stray = Checkpoint(alongTrackNm: 30, category: "lake", id: "x", lat: 42.5, lon: -88.0, predictedScore: 1, selected: false)
        #expect(DryRun.run(course: course, checkpoints: [stray], legs: [leg]) == nil)
        let run = DryRun()
        run.start(course: course, checkpoints: [], legs: [leg])
        #expect(run.running && abs((run.fix?.coordinate.latitude ?? 0) - 42.0) < 0.01)
        run.stop()
        #expect(!run.running && run.fix == nil)
    }
}
