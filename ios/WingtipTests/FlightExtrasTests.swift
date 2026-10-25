import CoreLocation
import Foundation
import Testing
@testable import Wingtip

/// The traffic, route-editing and in-flight answers as the documents spell
/// them, and what the app makes of them.
@MainActor
struct FlightExtrasDecodingTests {
    @Test func anAirplaneTrackedWithItsTraceAndTheFAAsRecord() throws {
        let json = #"{"hex":"a128b9","registration":"N174HA","type":"C172","description":"CESSNA 172S","operator":"FLIGHT SCHOOL INC","year":"2004","departed":{"ident":"C81","name":"Campbell","at":1761400000},"trail":[{"t":1761400000,"lat":42.32,"lon":-88.07,"alt_ft":null},{"t":1761400060,"lat":42.33,"lon":-88.06,"alt_ft":1500.0}],"faa":{"n_number":"N174HA","manufacturer":"CESSNA","model":"172S","year":2004,"mode_s_hex":"A128B9","status":"Valid","standing":"in effect","co_owners":0,"fractional":false,"horsepower":180,"thrust_lb":null,"owner":"FLIGHT SCHOOL INC","city":"Chicago","state":"IL"}}"#
        let detail = try Planner.snakeCase.decode(FlightDetail.self, from: Data(json.utf8))
        #expect(detail.operator == "FLIGHT SCHOOL INC" && detail.departed?.ident == "C81")
        #expect(detail.trail?.count == 2 && detail.trail?[0].altFt == nil && detail.trail?[1].altFt == 1500)
        #expect(detail.faa?.nNumber == "N174HA" && detail.faa?.modeSHex == "A128B9" && detail.faa?.horsepower == 180 && detail.faa?.coOwners == 0)
    }

    @Test func itsStateAndItsFlights() throws {
        let status = #"{"hex":"a128b9","airborne":false,"aircraft":null,"arrived":{"ident":"KDAW","at":1761400900,"city":"Rochester","name":"Skyhaven","region":"US-NH"},"departed":{"ident":"C81","city":null,"name":"Campbell","region":"US-IL"},"heard_s":120.0}"#
        let s = try Planner.snakeCase.decode(FlightStatus.self, from: Data(status.utf8))
        #expect(s.arrived?.ident == "KDAW" && s.heardS == 120 && s.aircraft == nil)
        let past = #"{"hex":"a128b9","flights":[{"id":3,"in_air":false,"landed":true,"max_alt_ft":4500.0,"off":1761390000,"on":1761393300,"origin":{"ident":"C81"},"destination":{"ident":"C81","city":"Lake Zurich","region":"US-IL"}}],"next_until":"2026-10-10","type":"C172","unread_days":0}"#
        let flights = try Planner.snakeCase.decode(PastFlights.self, from: Data(past.utf8))
        #expect(flights.flights?[0].maxAltFt == 4500 && flights.flights?[0].local == true && flights.nextUntil == "2026-10-10")
        let one = #"{"id":3,"points":[{"t":1761390000,"lat":42.3,"lon":-88.0,"alt_ft":800.0,"gs_kt":60.0,"track_deg":90.0,"vrate_fpm":500.0}]}"#
        let flight = try Planner.snakeCase.decode(PastFlight.self, from: Data(one.utf8))
        #expect(flight.points[0].gsKt == 60 && flight.points[0].vrateFpm == 500)
    }

    @Test func aSearchAFlightNumbersRouteAndWhereTheyAreBased() throws {
        let found = #"{"aircraft":[{"hex":"a1b2c3","lat":42.0,"lon":-88.0,"callsign":"UAL2088","altitude_ft":12000.0,"squawk":"7700"}],"checked":false,"license":"ODbL","registered":null,"source":"adsb.lol"}"#
        let f = try Planner.snakeCase.decode(TrafficFound.self, from: Data(found.utf8))
        #expect(f.aircraft[0].squawk == "7700" && f.checked == false && f.registered == nil)
        let route = #"{"airports":[{"ident":"TJSJ","location":"San Juan"},{"ident":"KORD","name":"Chicago O'Hare"}],"plausible":true}"#
        #expect(try Planner.snakeCase.decode(FlightRoute.self, from: Data(route.utf8)).airports.last?.ident == "KORD")
        // A callsign that is not an airline's: null, read as none.
        #expect(try Planner.snakeCase.decode(FlightRoute?.self, from: Data("null".utf8)) == nil)
        let based = #"{"based":{"a1b2c3":{"ident":"C81"},"d4e5f6":null},"pending":["d4e5f6"]}"#
        let b = try Planner.snakeCase.decode(AircraftBases.self, from: Data(based.utf8))
        #expect(b.based["a1b2c3"]??.ident == "C81" && b.pending == ["d4e5f6"])
    }

    @Test func thePointPressedAndTheAirspaceOverIt() throws {
        let json = #"{"lat":42.4,"lon":-88.1,"ground_ft":820.0,"bands":[{"class":"B","floor_ft":3600.0,"ceiling_ft":10000.0,"entry":"A clearance","name":"Chicago","equipment":"Mode C, ADS-B Out","speed_kt":200,"minimums":null}],"mode_c_veil":null,"point":{"base":"VPBNG","course_deg":95,"distance_nm":14.2,"ident":"VPBNG/095/14.2","name":"14 nm east of VPBNG","radial":false},"special_use":[],"tfrs":[]}"#
        let here = try Planner.snakeCase.decode(AirspaceAt.self, from: Data(json.utf8))
        #expect(here.bands[0].airspaceClass == "B" && here.bands[0].floorFt == 3600 && here.groundFt == 820)
        #expect(here.point?.ident == "VPBNG/095/14.2" && here.point?.courseDeg == 95)
    }

    @Test func aProceduresFixesWithTheChartsAltitudes() throws {
        let json = #"{"airport":"KELD","cycle":"2610","id":"I22","kind":"approach","name":"ILS RWY 22","transition":null,"fixes":[{"ident":"BXCMB","lat":33.2,"lon":-92.8,"min_ft":2400,"max_ft":null,"missed":false,"roles":["IAF"]},{"ident":"FAFIX","lat":33.21,"lon":-92.81,"min_ft":2000,"max_ft":2000,"missed":false,"roles":["FAF"]}],"holds":[],"lines":[]}"#
        let drawing = try Planner.snakeCase.decode(ProcedureDrawing.self, from: Data(json.utf8))
        #expect(drawing.fixes[0].charted == "at or above 2,400 ft")
        #expect(drawing.fixes[1].charted == "at 2,000 ft")
    }

    @Test func theNotesAsTheyAreWritten() throws {
        let lines = [
            #"{"type":"start","count":2}"#,
            #"{"type":"checkpoint","id":"c1","lat":42.1,"lon":-88.2,"description":"The water tower west of the lake.","source":"generated"}"#,
            #"{"type":"checkpoint","id":"c2","lat":42.2,"lon":-88.3,"description":null,"source":"error","detail":"Busy"}"#,
            #"{"type":"done"}"#,
        ]
        let read = try lines.map { try Planner.snakeCase.decode(NoteLine.self, from: Data($0.utf8)) }
        #expect(read[0].count == 2 && read[1].description?.hasPrefix("The water") == true && read[2].source == "error" && read[3].type == "done")
        #expect(CheckpointNotesView.key(42.1, -88.2) == "42.10000,-88.20000")
    }

    @Test func theGatewaysTrackAndFlightService() throws {
        let track = #"{"points":[{"t":1761390000000,"lat":42.3,"lon":-88.0,"altFt":null},{"t":1761390060000,"lat":42.31,"lon":-88.0,"altFt":1200.5}],"source":"gpx"}"#
        let t = try JSONDecoder().decode(SavedTrack.self, from: Data(track.utf8))
        #expect(t.points[1].altFt == 1200.5 && t.points[0].t == 1_761_390_000_000)
        let status = try JSONDecoder().decode(FlightServiceStatus.self, from: Data(#"{"connected":false,"provider":"none"}"#.utf8))
        #expect(status.connected == false)
        let request = FlightPlanFilingRequest(rules: "VFR", aircraftId: "N174HA", aircraftType: "C172", departure: "C81", departureTime: "2026-10-25T15:00:00Z",
                                              cruisingSpeed: "N0110", cruisingLevel: "A045", route: "DCT", destination: "KDLH", eetMinutes: 166, enduranceMinutes: 270)
        let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        #expect(sent?["aircraftId"] as? String == "N174HA" && sent?["eetMinutes"] as? Int == 166)
    }
}

/// The route's own edits, as the planner reads them.
@MainActor
struct RouteEditsTests {
    @Test func aHoldIsWrittenAsThePlannerReadsItAndReadBack() {
        let hold = Hold(fix: "VPBNG/090/30", inbound: 270, right: true, legMin: 1, turns: 2)
        #expect(hold.text == "VPBNG/090/30:270:R:1M:2T")
        #expect(hold.words == "Right turns · 270° inbound · 1 min legs · 2 turns")
        #expect(Hold.parse(hold.text) == hold)
        let north = Hold(fix: "KMSN", inbound: 0, right: false, legNm: 4, minutes: 10)
        #expect(north.text == "KMSN:000:L:4N:10M" && north.words.contains("360° inbound"))
        #expect(Hold.parse("KMSN:400:R:1M:2T") == nil && Hold.parse("KMSN:090:X:1M:2T") == nil)
    }

    @Test func theLegsAreAMinuteToFourteenThousandFeetAndAMinuteAndAHalfAbove() {
        #expect(Hold.legMinutes(altitudeFt: 14_000) == 1)
        #expect(Hold.legMinutes(altitudeFt: 14_500) == 1.5)
    }

    @Test func onlyTheEditsSetGoToTheNavLog() {
        var extras = RouteExtras()
        #expect(extras.query(procedures: []).isEmpty)
        extras.altitudes = ["KMSN": 1900, "VPBNG": 4500]
        extras.crossings = ["BXCMB": 3000]
        extras.holds = [Hold(fix: "VPBNG", inbound: 90, right: true, legMin: 1, turns: 2)]
        let pick = ProcedurePick(ident: "KELD", id: "I22", kind: "approach", name: "ILS RWY 22")
        extras.procedureDirect = ["KELD:I22": "BXCMB"]
        let query = extras.query(procedures: [pick])
        #expect(query["altitudes"] == "KMSN:1900,VPBNG:4500")
        #expect(query["crossings"] == "BXCMB:3000")
        #expect(query["holds"] == "VPBNG:090:R:1M:2T")
        #expect(query["procedures"] == "KELD:I22::BXCMB")
    }

    @Test func aPositionAndAFixOffAPointAreWrittenAsTheRouteWritesThem() {
        let fix = OwnShip.Fix(coordinate: CLLocationCoordinate2D(latitude: 42.32456, longitude: -88.07412), altitudeFt: 4523, trackDeg: 90, groundspeedKt: 110, accuracyM: 5, at: Date())
        #expect(RouteExtras.position(fix) == "@42.3246,-88.0741,4500")
        #expect(RouteExtras.frd("vpbng", courseDeg: 90, nm: 30) == "VPBNG/090/30")
        #expect(RouteExtras.frd("VPBNG", courseDeg: 360, nm: 14.2) == "VPBNG/000/14.2")
        #expect(PointAltitude.frd(from: "VPBNG", course: "095", distance: "14.2") == "VPBNG/095/14.2")
        #expect(PointAltitude.frd(from: "VPBNG", course: "95", distance: "14") == nil)
    }

    @Test func aPointsAltitudeIsUnderClassA() {
        #expect(PointAltitude.feet("045", waypoint: true) == 4500)
        #expect(PointAltitude.feet("1900", waypoint: false) == 1900)
        #expect(PointAltitude.feet("180", waypoint: true) == nil)
        #expect(PointAltitude.feet("", waypoint: false) == nil)
    }

    @Test func aDirectToSkipsTheRouteBeforeThePoint() {
        let was = RouteWas(dep: "C81", stops: ["KJVL", "KMSN", "KEAU"], dest: "KDLH")
        #expect(RouteExtras.directed(was, to: "KMSN", from: "@42.0,-88.0") == RouteWas(dep: "@42.0,-88.0", stops: ["KMSN", "KEAU"], dest: "KDLH"))
        #expect(RouteExtras.directed(was, to: "KDLH", from: nil) == RouteWas(dep: "C81", stops: [], dest: "KDLH"))
        #expect(RouteExtras.directed(was, to: "KORD", from: nil) == nil)
    }

    @Test func aDroppedPointGoesWhereItBendsTheRouteLeast() {
        let points = [CLLocationCoordinate2D(latitude: 42, longitude: -88), CLLocationCoordinate2D(latitude: 43, longitude: -89), CLLocationCoordinate2D(latitude: 46, longitude: -92)]
        #expect(RouteExtras.bestStopIndex(points, at: CLLocationCoordinate2D(latitude: 44.5, longitude: -90.6)) == 1)
        #expect(RouteExtras.bestStopIndex(points, at: CLLocationCoordinate2D(latitude: 42.4, longitude: -88.5)) == 0)
    }

    @Test func aDirectToIsCancelledBackToTheRouteAsItWas() {
        let plan = Plan()
        plan.dep = "C81"; plan.dest = "KDLH"; plan.stops = ["KJVL", "KMSN"]
        plan.directTo("KMSN", from: nil)
        #expect(plan.dep == "C81" && plan.stops == ["KMSN"] && plan.extras.direct == "KMSN")
        plan.cancelDirect()
        #expect(plan.stops == ["KJVL", "KMSN"] && plan.extras.direct == nil && plan.extras.was == nil)
        plan.insertFix("KJVL/090/10", after: "KJVL")
        #expect(plan.stops == ["KJVL", "KJVL/090/10", "KMSN"])
        plan.setHold(at: "KMSN", Hold(fix: "KMSN", inbound: 180, right: true, legMin: 1, turns: 1))
        #expect(plan.hold(at: "kmsn")?.inbound == 180)
        plan.clear()
        #expect(plan.extras == RouteExtras())
    }
}

/// The traffic's words, colours and alerts.
@MainActor
struct TrafficExtrasTests {
    private func status(airborne: Bool?, arrived: String? = nil, heardS: Double? = nil) -> FlightStatus {
        FlightStatus(hex: "a1b2c3", airborne: airborne, aircraft: nil, arrived: arrived.map { FlightArrival(at: 0, ident: $0) },
                     departed: PastFlightField(ident: "C81"), heardS: heardS)
    }

    @Test func aWatchGoesOffOnceWhenItTakesOffOrLands() {
        let takeoff = AirplaneWatch(hex: "a1b2c3", name: "N174HA", kind: .takeoff)
        let land = AirplaneWatch(hex: "a1b2c3", name: "N174HA", kind: .land)
        #expect(Tracking.fired(takeoff, before: false, now: true, status: status(airborne: true)) == "N174HA took off from C81")
        #expect(Tracking.fired(takeoff, before: true, now: true, status: status(airborne: true)) == nil)
        #expect(Tracking.fired(land, before: true, now: false, status: status(airborne: false, arrived: "KDAW")) == "N174HA landed at KDAW")
        #expect(Tracking.fired(land, before: nil, now: false, status: status(airborne: false, arrived: "KDAW")) == nil)
    }

    @Test func anAirplaneUnheardForHalfAnHourIsOnTheGround() {
        #expect(Tracking.airborneNow(before: nil, status(airborne: false, heardS: 3600)) == false)
        #expect(Tracking.airborneNow(before: nil, status(airborne: false, heardS: 60)) == nil)
        #expect(Tracking.airborneNow(before: true, status(airborne: false, heardS: 60)) == true)
        #expect(Tracking.airborneNow(before: true, status(airborne: false, arrived: "KDAW")) == false)
    }

    @Test func aPathIsColouredByItsHeightInWholeRuns() {
        #expect(HeightColour.hue(nil) == nil)
        #expect(HeightColour.hue(0) == 120)
        #expect(HeightColour.hue(40_000) == 300 && HeightColour.hue(60_000) == 300)
        let runs = HeightColour.runs([PathPoint(t: 0, lat: 1, lon: 1, altFt: 1000), PathPoint(t: 1, lat: 2, lon: 2, altFt: 1100), PathPoint(t: 2, lat: 3, lon: 3, altFt: 9000)])
        #expect(runs.count == 2 && runs[0].points.count == 2 && runs[1].points.count == 2 && runs[1].points[0].latitude == 2)
    }

    @Test func theCardsWords() {
        #expect(FlightWords.nameCase("CESSNA 172S") == "Cessna 172S")
        #expect(FlightWords.nameCase("UNITED AIRLINES INC") == "United Airlines Inc")
        #expect(FlightWords.lasted(3 * 3600 + 13 * 60) == "3 h 13 min" && FlightWords.lasted(41 * 60) == "41 min")
        #expect(FlightWords.place(PastFlightField(ident: "KDAW", city: "Rochester", region: "US-NH")) == "Rochester, NH")
        #expect(FlightWords.place(PastFlightField(ident: "EGLL", city: "London", region: "GB-ENG")) == "London")
        #expect(FlightWords.against(480) == "500 ft above" && FlightWords.against(-1240) == "1,200 ft below" && FlightWords.against(20) == "level")
        #expect(FlightWords.compass(44) == "NE" && FlightWords.compass(359) == "N")
        #expect(FlightWords.squawks["7700"] == "emergency")
        #expect(TrafficFindView.named(TrafficAircraft(hex: "a128b9", lat: 0, lon: 0, callsign: "N174HA", registration: "N174HA"), "N174"))
    }

    @Test func theTrackedAirplanesPathGrowsWithItsReports() {
        let tracking = Tracking()
        let plane = TrafficAircraft(hex: "A128B9", lat: 42, lon: -88, altitudeFt: 3000)
        tracking.track("a128b9")
        tracking.reported(plane, at: Date(timeIntervalSince1970: 100))
        tracking.reported(TrafficAircraft(hex: "a128b9", lat: 42.1, lon: -88, altitudeFt: 3100), at: Date(timeIntervalSince1970: 105))
        // An older report than the last is not a point of the path.
        tracking.reported(plane, at: Date(timeIntervalSince1970: 90))
        #expect(tracking.path.count == 2 && tracking.latest?.lat == 42.1)
        tracking.seed([TrailPoint(t: 50, lat: 41.9, lon: -88, altFt: nil), TrailPoint(t: 101, lat: 0, lon: 0, altFt: nil)], for: "a128b9")
        #expect(tracking.path.count == 3 && tracking.path[0].t == 50)
        tracking.track(nil)
        #expect(tracking.path.isEmpty && tracking.hex == nil)
    }
}

/// The alerts ahead as said.
@MainActor
struct SpokenAlertsTests {
    private func alert(_ id: String, name: String, seconds: Double, kind: String = "airspace", clearance: Double? = nil, inside: Bool = false) -> AheadAlert {
        AheadAlert(id: id, kind: kind, level: "caution", name: name, need: "A clearance", seconds: seconds, distanceNm: 4, lat: 0, lon: 0,
                   inside: inside, clearanceFt: clearance)
    }

    @Test func eachIsSaidOnceTheSoonestFirstAndAgainOnlyAfterItHasGone() {
        let b = alert("b", name: "Chicago Class B", seconds: 120)
        let tower = alert("t", name: "Tower 2,700 ft", seconds: 40, kind: "obstacle", clearance: 300)
        let first = SpokenAlerts.toSay([b, tower], said: [])
        #expect(first.words == "Tower 2,700 feet, 300 feet below you, in 40 seconds, and 1 more.")
        #expect(SpokenAlerts.toSay([b, tower], said: first.said).words == nil)
        let gone = SpokenAlerts.toSay([], said: first.said)
        #expect(gone.said.isEmpty)
        #expect(SpokenAlerts.toSay([b], said: gone.said).words == "Chicago Class B, in 2 minutes.")
    }

    @Test func whenIsSaidAsAVoiceReadsIt() {
        #expect(SpokenAlerts.when(alert("a", name: "X", seconds: 5)) == "now")
        #expect(SpokenAlerts.when(alert("a", name: "X", seconds: 42)) == "in 40 seconds")
        #expect(SpokenAlerts.when(alert("a", name: "X", seconds: 70)) == "in 1 minute")
        #expect(SpokenAlerts.when(alert("a", name: "X", seconds: 70, inside: true)) == "inside")
        #expect(SpokenAlerts.line(alert("f", name: "FDC 5/1234", seconds: 200, kind: "tfr")) == "TFR, in 3 minutes")
    }
}

/// The route as it goes to other places, and the flight plan's items.
@MainActor
struct ShareAndFilingTests {
    @Test func theFormsItemsAsAIMAppendix4WritesThem() {
        #expect(FilingForm.cruisingSpeed(109.6) == "N0110")
        #expect(FilingForm.cruisingLevel(4500) == "A045" && FilingForm.cruisingLevel(18_000) == "F180")
        #expect(FilingForm.route([]) == "DCT" && FilingForm.route(["KJVL", "KMSN"]) == "KJVL DCT KMSN")
        #expect(FilingForm.hhmm(166) == "0246")
    }

    @Test func theRoutesLinkAndForeFlightsPack() {
        let plan = Plan()
        plan.dep = "C81"; plan.dest = "KDLH"; plan.stops = ["KMSN"]
        let link = RouteShare.link(plan).absoluteString
        #expect(link.contains("/app/plan?") && link.contains("dep=C81") && link.contains("stops=KMSN"))
        #expect(RouteShare.packURL(plan).path().hasSuffix("/api/planner/foreflight-pack/C81-KMSN-KDLH/C81-KMSN-KDLH-checkpoints.zip"))
        let open = RouteShare.openPack(URL(string: "https://x.app/p/C81-KDLH.zip")!).absoluteString
        #expect(open == "https://foreflight.com/content?downloadURL=https%3A%2F%2Fx.app%2Fp%2FC81-KDLH.zip")
        #expect(RouteShare.fileName(plan) == "C81-KMSN-KDLH")
    }

    @Test func aGPXFilesTrackPointsWithTheirTimes() {
        let gpx = #"<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="42.3" lon="-88.0"><ele>300</ele><time>2026-10-25T15:00:00Z</time></trkpt><trkpt lat="42.31" lon="-88.0"><time>2026-10-25T15:00:05.500Z</time></trkpt><trkpt lat="42.32" lon="-88.0"></trkpt></trkseg></trk></gpx>"#
        let points = GPXTrack.points(Data(gpx.utf8)) ?? []
        #expect(points.count == 2)
        #expect(points.first?.t == 1_792_940_400_000 && abs((points.first?.altFt ?? 0) - 984.25) < 0.01 && points.last?.altFt == nil)
    }
}
