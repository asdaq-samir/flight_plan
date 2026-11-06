import XCTest
@testable import Wingtip

/// The app's speed as numbers the runner keeps (XCTest's performance
/// metrics, with a baseline once the owner sets one in Xcode): the engine
/// asked a rule many times over, as a pan or a dry run asks it, and the
/// planner's answers decoded as the map decodes them. A slower build
/// fails here before a phone feels it (the owner's ask, 2026-11-03: a
/// fast app, measured). XCTest's own measure, not Swift Testing's, since
/// only XCTest keeps metrics and baselines.
final class PerformanceTests: XCTestCase {
    private var clearances: [String] = []

    override func setUpWithError() throws {
        // The shared fixture every reader of a clearance is held to
        // (web/src/lib/fixtures/clearances.json), bundled with the tests.
        let url = try XCTUnwrap(Bundle(for: PerformanceTests.self).url(forResource: "clearances", withExtension: "json"))
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        let cases = try XCTUnwrap(fixture?["read"] as? [[String: Any]])
        clearances = cases.compactMap { $0["heard"] as? String }
        XCTAssertFalse(clearances.isEmpty)
    }

    /// The clearance reader through the engine, two hundred readings:
    /// the radio's every transmission is read this way as it comes.
    func testReadingClearancesThroughTheEngine() throws {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric()], options: options) {
            for _ in 0..<200 {
                for heard in clearances {
                    _ = try? Engine.callJSON("read_clearance", ["text": heard])
                }
            }
        }
    }

    /// A hold's entry and wind, a thousand times: the figure the holding
    /// sheet asks for at every turn of its dials (AIM 5-3-8).
    func testHoldingThroughTheEngine() throws {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTClockMetric()], options: options) {
            for heading in stride(from: 0, to: 1000, by: 1) {
                _ = try? Engine.callJSON("holding", ["inbound": 270, "heading": heading % 360, "turns": "right", "tas_kt": 100, "wind_from": 320, "wind_kt": 15])
            }
        }
    }

    /// The fields of a box decoded as the map decodes a planner answer,
    /// a hundred times: a pan's answer is a thousand fields.
    func testDecodingAirportsInView() throws {
        let one = """
        {"ident":"KDLH","name":"Duluth International Airport","lat":46.8421,"lon":-92.1936,"kind":"medium","flight_category":"VFR","military":null,"private":false,"airspace_class":"C","primary_of":"C"}
        """
        let body = Data("{\"airports\":[\(Array(repeating: one, count: 1000).joined(separator: ","))]}".utf8)
        // The answer's shape as Planner.airports decodes it.
        struct Answer: Decodable { let airports: [AirportPin] }
        let decoder = JSONDecoder()
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric()]) {
            for _ in 0..<100 {
                _ = try? decoder.decode(Answer.self, from: body)
            }
        }
    }
}
