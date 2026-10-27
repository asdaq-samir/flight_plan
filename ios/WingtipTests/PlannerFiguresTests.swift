import Foundation
import Testing
@testable import Wingtip

/// The four figures the planner works out for this app (app.figures): each
/// answer read as the document shapes it, each question sent in its snake
/// case, and how the pages write the planner's figures.
struct PlannerFiguresTests {
    static let debrief = #"""
    {"debrief":{"takeoff":1791990120000,"landing":1791992280000,"flown_min":36.0,"planned_min":36.0,
      "legs":[{"from":"A","to":"Lake","planned_alt_ft":3500,"altitude_within":1.0,"worst_alt_ft":100,"course_deg":0,"course_within":1.0,"worst_off_nm":0.5,"ok":true},
              {"from":"Lake","to":"B","planned_alt_ft":3500,"altitude_within":0.86,"worst_alt_ft":300,"course_deg":0,"course_within":1.0,"worst_off_nm":0.5,"ok":false}],
      "passes":[{"name":"Lake","category":"lake","landed":false,"due_min":18,"passed_min":18.1,"closest_nm":0.5,"late_min":0.1,"ok":true},
                {"name":"B","category":"destination","landed":true,"due_min":36,"passed_min":36.0,"closest_nm":0.4,"late_min":0.0,"ok":true}],
      "patterns":[{"ident":"B","alt_ft":2100,"pattern_ft":1700,"off_ft":400,"ok":false}],
      "profile":[{"along_nm":0.1,"alt_ft":700}],"planned":[{"from_nm":0,"to_nm":30,"alt_ft":3500}],
      "line":[{"lat":42.0,"lon":-87.99,"off":false}],"has_altitude":true,"notes":[]},
     "tolerances":{"altitude_ft":200,"course_deg":15,"off_route_nm":3,"eta_min":5,"pattern_nm":1.5,"pattern_ft":100}}
    """#

    @Test func theDebriefReadsWithEachMark() throws {
        let answer = try Planner.snakeCase.decode(DebriefAnswer.self, from: Data(Self.debrief.utf8))
        let d = try #require(answer.debrief)
        #expect(d.legs.map(\.ok) == [true, false])
        #expect(d.legs[1].from == "Lake" && d.legs[1].worstAltFt == 300)
        #expect(d.passes[1].landed && d.passes[0].ok == true)
        #expect(d.patterns.first?.offFt == 400 && d.patterns.first?.ok == false)
        #expect(answer.tolerances.offRouteNm == 3 && answer.tolerances.patternFt == 100)
        // A track that never flew is an answer with no debrief.
        let none = try Planner.snakeCase.decode(DebriefAnswer.self, from: Data(#"{"debrief":null,"tolerances":{"altitude_ft":200,"course_deg":15,"off_route_nm":3,"eta_min":5,"pattern_nm":1.5,"pattern_ft":100}}"#.utf8))
        #expect(none.debrief == nil)
    }

    @Test func theDebriefIsAskedWithTheFlightsCheckpointsAndTheTrackInSnakeCase() throws {
        let flight = try JSONDecoder().decode(SavedFlightDetail.self, from: Data(#"""
        {"id":7,"departureIdent":"A","destinationIdent":"B","checkpoints":[
         {"sequenceNo":0,"name":"A","category":"departure","lat":42,"lon":-88,"alongTrackNm":0,"legDistanceNm":null,"trueCourseDeg":null,"eteMin":null,"altitudeFt":null},
         {"sequenceNo":1,"name":"B","category":"destination","lat":43,"lon":-88,"alongTrackNm":60,"trueCourseDeg":0,"eteMin":36,"altitudeFt":3500}]}
        """#.utf8))
        let ask = DebriefAsk(checkpoints: flight.checkpoints, points: [SavedTrackPoint(t: 1791990120000, lat: 42, lon: -88, altFt: 700)])
        let sent = try #require(try JSONSerialization.jsonObject(with: Planner.snakeEncoder.encode(ask)) as? [String: Any])
        let first = try #require((sent["checkpoints"] as? [[String: Any]])?.last)
        #expect(first["sequence_no"] as? Int == 1 && first["along_track_nm"] as? Double == 60 && first["true_course_deg"] as? Double == 0)
        #expect(first["ete_min"] as? Double == 36 && first["altitude_ft"] as? Double == 3500)
        let point = try #require((sent["points"] as? [[String: Any]])?.first)
        #expect(point["alt_ft"] as? Double == 700 && point["t"] as? Int64 == 1791990120000)
    }

    @Test func theDiversionReadsWithItsStepsAndChecks() throws {
        let answer = try Planner.snakeCase.decode(DiversionAnswer.self, from: Data(#"""
        {"to":"KMSN","name":"Dane County Regional","altitude_ft":4500,"tas_kt":110,"fuel_burn_gph":8.5,"magnetic_variation_deg":-3,
         "wind":{"wind_dir_true_deg":270,"wind_speed_kt":20},
         "solved":{"tc":360,"distance_nm":18,"wca":-10.48,"th":349.52,"mh":352.52,"gs":108.2,"ete":9.98,"fuel":1.41},
         "steps":[{"name":"True course","value":"360°, 18.0 nm"},{"name":"Magnetic heading","value":"353°"}],
         "problem":null,
         "checks":[{"key":"mh","label":"Magnetic heading","unit":"°","allowance":10,"typed":355,"exact":352.52,"written":"353°","reasonable":true},
                   {"key":"ete","label":"Time","unit":"min","allowance":3,"typed":null,"exact":9.98,"written":"10 min","reasonable":null}]}
        """#.utf8))
        #expect(answer.solved?.mh == 352.52 && answer.wind?.windSpeedKt == 20)
        #expect(answer.steps.first?.value == "360°, 18.0 nm")
        #expect(answer.checks.map(\.reasonable) == [true, nil])
        let stuck = try Planner.snakeCase.decode(DiversionAnswer.self, from: Data(#"""
        {"to":"KMSN","name":"Dane County Regional","altitude_ft":4500,"tas_kt":50,"fuel_burn_gph":5,"magnetic_variation_deg":0,"wind":null,
         "solved":null,"steps":[],"problem":"The wind is too strong for a heading to KMSN to hold.","checks":[]}
        """#.utf8))
        #expect(stuck.solved == nil && stuck.problem?.hasPrefix("The wind is too strong") == true)
    }

    @Test func theHoldReadsWithItsEntryAndWind() throws {
        let answer = try Planner.snakeCase.decode(HoldingAnswer.self, from: Data(#"""
        {"entry":"parallel","entry_name":"Parallel","steps":"At the fix, turn to 180°…","either":null,"either_name":null,"approach_relative":40,
         "wind":{"leg_min":1,"inbound":{"heading":360,"wca":0,"gs":80},"outbound":{"heading":180,"wca":0,"gs":120},"outbound_sec":40,"rule_sec":40,
          "inbound_words":"0° for the wind, 80 kt over the ground","outbound_words":"Three times the inbound correction, 0°, the turns' drift taken up too",
          "time_words":"So the inbound leg takes a minute at 80 kt; by the rule of a second a knot, 40 s"},"wind_problem":null}
        """#.utf8))
        #expect(answer.entry == "parallel" && answer.approachRelative == 40 && answer.either == nil)
        #expect(answer.wind?.outboundSec == 40 && answer.wind?.outbound.gs == 120)
    }

    @Test func lostCommsIsAskedInSnakeCaseAndReadsEachSegment() throws {
        let ask = LostCommsAsk(segments: [LostCommsSegmentAsk(name: "SWEDE to RAYMO", minimumFt: 5000)], assignedFt: 4000, expectedFt: 6000,
                               expectedFrom: 0, approachFix: false, efc: "", eta: "1435Z")
        let sent = try #require(try JSONSerialization.jsonObject(with: Planner.snakeEncoder.encode(ask)) as? [String: Any])
        #expect(sent["assigned_ft"] as? Double == 4000 && sent["expected_from"] as? Int == 0 && sent["approach_fix"] as? Bool == false)
        #expect((sent["segments"] as? [[String: Any]])?.first?["minimum_ft"] as? Double == 5000)
        let answer = try Planner.snakeCase.decode(LostCommsAnswer.self, from: Data(#"""
        {"vfr":"In VFR conditions…","routes":[{"key":"assigned","label":"Assigned","rule":"The route assigned in the last ATC clearance received."}],
         "segments":[{"name":"SWEDE to RAYMO","fly":6000,"because":"expected","words":"Fly 6,000 ft: expected"},{"name":"x","fly":null,"because":null,"words":"No altitude known"}],
         "leave":"Leave the clearance limit on arriving over it, proceed to a fix an approach begins from, and begin the descent or the approach as close as possible to your estimated time of arrival, 1435Z."}
        """#.utf8))
        #expect(answer.segments.map(\.words) == ["Fly 6,000 ft: expected", "No altitude known"])
        #expect(answer.segments[1].fly == nil && answer.leave.hasSuffix("1435Z."))
    }

    @Test func thePlannersFiguresAreWrittenAsAPilotWritesThem() {
        #expect(AirportWords.bearing(0) == "360°")
        #expect(AirportWords.bearing(4.6) == "005°")
        #expect(AirportWords.bearing(352.52) == "353°")
        #expect(FigureWords.signed(300, " ft") == "+300 ft")
        #expect(FigureWords.signed(-2.4, " min") == "−2 min")
        #expect(FigureWords.signed(0, " ft") == "0 ft")
        #expect(AirportWords.tenths(1.5) == "1.5" && AirportWords.tenths(200) == "200")
        #expect(FigureWords.percent(0.856) == "86%")
    }
}
