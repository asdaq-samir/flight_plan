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
