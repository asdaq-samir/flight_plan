import CoreLocation
import Foundation
import Testing
@testable import Wingtip

/// The briefing's hazards placed on the legs (OnRoute) as the planner's
/// document spells them, and their words as the web app's lib/onRoute
/// writes them.
@MainActor
struct BriefLegsTests {
    private let utc = TimeZone(identifier: "UTC")!

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try Planner.snakeCase.decode(T.self, from: Data(json.utf8))
    }

    private func on(legs: [Int] = [1, 2], enter: String = "2026-10-04T14:20:00Z", leave: String = "2026-10-04T14:45:00Z",
                    validFrom: String? = "2026-10-04T13:00:00Z", validTo: String? = "2026-10-04T15:00:00Z",
                    when: String? = "during", source: String = "SIGMET", issued: String? = nil) -> OnRoute {
        OnRoute(legs: legs, fromNm: 40, toNm: 70, enter: enter, leave: leave, validFrom: validFrom, validTo: validTo,
                when: when, source: source, issued: issued)
    }

    @Test func aBriefingsHazardsWithTheirLegsTimesAndFields() throws {
        let json = #"""
        {"hazards":[{"hazard":"CONVECTIVE","type":"SIGMET","altitude_low_ft":null,"altitude_high_ft":43000.0,"raw":"CONVECTIVE SIGMET 45C",
          "on_route":{"legs":[1,2],"from_nm":40.2,"to_nm":70.0,"enter":"2026-10-04T14:20:00Z","leave":"2026-10-04T14:45:00Z",
          "valid_from":"2026-10-04T13:00:00Z","valid_to":"2026-10-04T15:00:00Z","when":"during","source":"Convective SIGMET","issued":"2026-10-04T12:55:00Z"}}],
         "forecast":{"min_ceiling_ft":null,"min_visibility_sm":null,"stations":[]},"metars":{"C81":null},"airports":{},
         "weather_unavailable":[],"tfrs":[],"gairmets":[{"hazard":"Icing","severity":"MOD","due_to":"ICE","valid_at":"2026-10-04T15:00:00Z",
          "issued":null,"altitude_low_ft":null,"from_freezing_level":true,"altitude_high_ft":16000.0,"on_route":null}],
         "pireps":[{"observed_at":"2026-10-04T13:40:00Z","altitude_ft":5500.0,"aircraft":"C172","urgent":false,"turbulence":"MOD","icing":null,
          "raw":"UA /OV ...","along_track_nm":30.0,"on_route":{"legs":[0],"from_nm":30.0,"to_nm":30.0,"enter":"2026-10-04T14:10:00Z",
          "leave":"2026-10-04T14:10:00Z","valid_from":null,"valid_to":null,"when":null,"source":"PIREP","issued":"2026-10-04T13:40:00Z"}}],
         "vfr_not_recommended":[],
         "fields_below_vfr":[{"ident":"KDLH","source":"METAR","flight_category":"IFR","ceiling_ft":700.0,"visibility_sm":2.0,
          "on_route":{"legs":[2],"from_nm":250.0,"to_nm":250.0,"enter":"2026-10-04T16:00:00Z","leave":"2026-10-04T16:00:00Z",
          "valid_from":null,"valid_to":null,"when":null,"source":"METAR","issued":"2026-10-04T13:53:00Z"}}],
         "leg_fixes":[{"lat":42.0,"lon":-88.0},{"lat":43.0,"lon":-88.0},{"lat":44.0,"lon":-88.0},{"lat":46.8,"lon":-92.2}],
         "legs_from":"navlog"}
        """#
        let briefing = try decode(Briefing.self, json)
        #expect(briefing.hazards[0].onRoute?.legs == [1, 2] && briefing.hazards[0].onRoute?.source == "Convective SIGMET")
        #expect(briefing.gairmets?.first?.onRoute == nil)
        #expect(briefing.pireps?.first?.onRoute?.issued == "2026-10-04T13:40:00Z")
        #expect(briefing.fieldsBelowVfr?.first?.flightCategory == "IFR" && briefing.fieldsBelowVfr?.first?.onRoute.legs == [2])
        #expect(briefing.legFixes?.count == 4 && briefing.legsFrom == "navlog")
        // A briefing from before the planner placed them still reads.
        let older = try decode(Briefing.self, #"{"hazards":[{"hazard":"ICE"}],"metars":{},"weather_unavailable":[]}"#)
        #expect(older.hazards[0].onRoute == nil && older.legFixes == nil)
    }

    @Test func theMapsLayerAges() throws {
        let ages = try decode(MapLayerAges.self, #"{"metars_at":"2026-10-04T14:00:00Z","tfrs_at":null}"#)
        #expect(ages.metarsAt == "2026-10-04T14:00:00Z" && ages.tfrsAt == nil)
        let now = BriefLegs.date("2026-10-04T14:04:30Z")!
        #expect(BriefLegs.age(BriefLegs.date(ages.metarsAt), now: now) == "4 min ago")
        #expect(BriefLegs.age(now.addingTimeInterval(-20), now: now) == "just now")
        #expect(BriefLegs.age(now.addingTimeInterval(-125 * 60), now: now) == "2 h 5 min ago")
        #expect(BriefLegs.age(nil, now: now) == nil)
    }

    @Test func legsAreSaidAsTheNavLogNumbersThem() {
        #expect(BriefLegs.legWords([1]) == "Leg 2")
        #expect(BriefLegs.legWords([2, 1]) == "Legs 2–3")
        #expect(BriefLegs.legWords([0, 2, 3]) == "Legs 1, 3–4")
        #expect(BriefLegs.legWords([]) == "")
    }

    @Test func aHazardsLineIsItsLegsTheAirplanesTimeAndItsOwn() {
        #expect(BriefLegs.line(on(), zone: utc) == "Legs 2–3 · 14:20–14:45, valid till 15:00")
        #expect(BriefLegs.line(on(validFrom: "2026-10-04T16:00:00Z", when: "before"), zone: utc) == "Legs 2–3 · 14:20–14:45, before it starts at 16:00")
        #expect(BriefLegs.line(on(when: "after"), zone: utc) == "Legs 2–3 · 14:20–14:45, after it ends at 15:00")
        let pirep = on(legs: [0], enter: "2026-10-04T14:10:00Z", leave: "2026-10-04T14:10:00Z", validFrom: nil, validTo: nil, when: nil,
                       source: "PIREP", issued: "2026-10-04T13:40:00Z")
        #expect(BriefLegs.line(pirep, zone: utc) == "Leg 1 · 14:10, reported 13:40")
        // A G-AIRMET's window is its snapshot's, not the product's.
        #expect(!BriefLegs.line(on(source: "G-AIRMET"), zone: utc).contains("valid till"))
    }

    @Test func theLegsLinesJoinNeighboursAndLeaveOutLegsPastTheFixes() {
        let fixes = (0..<5).map { RoutePoint(lat: Double($0), lon: 0) }
        #expect(BriefLegs.lines([1, 2], fixes: fixes).map { $0.map(\.latitude) } == [[1, 2, 3]])
        #expect(BriefLegs.lines([0, 3, 9], fixes: fixes).map { $0.map(\.latitude) } == [[0, 1], [3, 4]])
    }

    @Test func theNavLogsLegsAreAskedForWithTheirFixesInTheOrderFlown() throws {
        let course = try decode(Course.self, #"""
        {"departure":{"ident":"C81","name":"Campbell","lat":42.1,"lon":-88.1},"destination":{"ident":"KDLH","name":"Duluth","lat":46.8,"lon":-92.2},
         "stops":[{"ident":"KMSN","name":"Madison","lat":43.1,"lon":-89.3}],"distance_nm":300,"bearing_deg":330,"course_line":[]}
        """#)
        let checkpoint = try decode(Checkpoint.self, #"{"id":"a","category":"lake","lat":42.6,"lon":-88.6,"predicted_score":3,"along_track_nm":20,"selected":true,"hop":0}"#)
        let leg = { (ete: Double?, ground: Double?) in
            Leg(from: "A", to: "B", distanceNm: 30, altitudeFt: 4500, trueCourseDeg: 330, magneticHeadingDeg: 332, eteMin: ete, tasKt: 110, groundMin: ground)
        }
        let query = BriefLegs.query(course: course, checkpoints: [checkpoint], legs: [leg(10, nil), leg(20, 45), leg(30, nil)])
        #expect(query?.fixes == "42.10000,-88.10000;42.60000,-88.60000;43.10000,-89.30000;46.80000,-92.20000")
        #expect(query?.legMin == "10.0,20.0,30.0" && query?.groundMin == "0,45,0")
        // Legs that do not match the fixes, or one with no time: none.
        #expect(BriefLegs.query(course: course, checkpoints: [], legs: [leg(10, nil), leg(20, nil), leg(30, nil)]) == nil)
        #expect(BriefLegs.query(course: course, checkpoints: [checkpoint], legs: [leg(10, nil), leg(nil, nil), leg(30, nil)]) == nil)
    }
}
