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
        #expect(course.coordinates.count == 3 && course.coordinates[1].latitude == 44.5 && course.stops.isEmpty)
    }

    @Test func minutesReadAsHoursAndMinutes() {
        #expect(hoursMinutes(165) == "2h 45m")
        #expect(hoursMinutes(5.4) == "0h 05m")
    }
}
