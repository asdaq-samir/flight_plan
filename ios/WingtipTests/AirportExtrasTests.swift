import Foundation
import Testing
@testable import Wingtip

/// The airport card's and the map's answers as the planner's document
/// spells them, and the card's words as the web app writes them.
@MainActor
struct AirportExtrasTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try Planner.snakeCase.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Decoding

    @Test func aCardWithItsChartsRadioNotesAndANearbyReport() throws {
        let json = #"{"ident":"C81","name":"Campbell","lat":42.32,"lon":-88.07,"kind":"small","towered":false,"private":false,"address":"2100 Main St","phone":"815-555-0100","airport_diagram_url":null,"airport_diagram_cycle":null,"chart_supplement_url":"https://aeronav.faa.gov/afd/09oct2026/ec_123.pdf","procedures":[{"kind":"IAP","name":"RNAV (GPS) RWY 24","url":"https://aeronav.faa.gov/d-tpp/2610/00123R24.PDF"}],"radio_notes":["Weather on 3 clicks"],"standard_keying":true,"lighting":["Runway lights on 122.8"],"weather_unavailable":false,"metar":null,"modelled_weather":{"flight_category":"MVFR","visibility_sm":10.0,"ceiling_ft":2500.0,"valid_at":"2026-10-25T13:00:00Z"},"nearby_metar":{"ident":"KUGN","distance_nm":11.0,"bearing_deg":45,"near":false,"metar":{"raw":"KUGN 251255Z 24008KT 10SM FEW030 09/03 A3012","flight_category":"VFR"}},"runways":[{"ends":"06/24","length_ft":3700,"width_ft":60,"surface":"ASPH","lighted":true,"closed":false,"runway_ends":[{"ident":"06","heading_true_deg":58.0,"lat":42.318,"lon":-88.08,"traffic":"left"},{"ident":"24","heading_true_deg":238.0,"lat":42.322,"lon":-88.065,"traffic":"right"}],"turf":[],"wind":null}],"frequencies":[{"type":"CTAF","description":"CTAF","frequency_mhz":122.8}],"pattern":{"agl_ft":1000.0,"altitude_ft":1800.0,"published":false}}"#
        let place = try decode(AirportPlace.self, json)
        #expect(place.procedures?.first?.kind == "IAP" && place.chartSupplementUrl?.hasSuffix(".pdf") == true)
        #expect(place.radioNotes == ["Weather on 3 clicks"] && place.standardKeying == true && place.`private` == false)
        #expect(place.nearbyMetar?.ident == "KUGN" && place.nearbyMetar?.bearingDeg == 45 && place.nearbyMetar?.metar.flightCategory == "VFR")
        #expect(place.runways[0].runwayEnds?[1].traffic == "right" && place.runways[0].runwayEnds?[0].headingTrueDeg == 58)
        // No report of its own: the modelled category is the chip's, marked as not its own.
        let chip = AirportHead.category(place)
        #expect(chip?.category == "MVFR" && chip?.own == false)
        #expect(AirportHead.restriction(place) == nil)
    }

    @Test func photosAndServices() throws {
        let photos = try decode(AirportPhotos.self, #"{"aerial_url":"/api/planner/airport-aerial/KDLH.jpg","photo":{"url":"/api/planner/airport-photo/KDLH.jpg","width":900,"height":600,"credit":"J. Doe","license":"CC BY-SA 4.0","source_url":null}}"#)
        #expect(photos.aerialUrl.hasSuffix("KDLH.jpg") && photos.photo?.license == "CC BY-SA 4.0")
        let none = try decode(AirportPhotos.self, #"{"aerial_url":"/api/planner/airport-aerial/C81.jpg","photo":null}"#)
        #expect(none.photo == nil)
        let services = try decode(AirportServices.self, #"{"ident":"KDLH","fuel_types":["100LL","A"],"fuel_notes":["Self-serve 24 hours"],"courtesy_car":true,"ground_notes":["Ask the FBO"],"tie_down":true,"hangar":false,"airframe_repair":"major","powerplant_repair":null,"oxygen":false,"landing_fee":null,"food":[{"name":"Diner","kind":"restaurant","lat":46.8,"lon":-92.2,"distance_m":800,"walk_min":10,"phone":null,"website":"https://diner.example"}],"lodging":[],"cars":[],"nearby_unavailable":false}"#)
        #expect(services.fuelTypes == ["100LL", "A"] && services.courtesyCar == true && services.landingFee == nil)
        #expect(services.food?.first?.walkMin == 10 && services.airframeRepair == "major")
        #expect(AirportWords.fuelNames(services.fuelTypes ?? []) == "100LL, Jet A")
        #expect(AirportWords.away(services.food![0]) == "10 min walk")
        let drive = NearbyPlace(name: "Inn", kind: "hotel", lat: 0, lon: 0, distanceM: 3219, walkMin: nil, phone: nil, website: nil)
        #expect(AirportWords.away(drive) == "2.0 mi")
    }

    @Test func theAirspaceOverAPoint() throws {
        let json = #"{"lat":42.3172,"lon":-88.0905,"ground_ft":790.0,"bands":[{"class":"G","floor_ft":0.0,"ceiling_ft":1490.0,"entry":"Nothing.","minimums":{"day":{"visibility_sm":1.0,"clear_of_clouds":true},"night":{"visibility_sm":3.0,"clear_of_clouds":false,"below_ft":500.0,"above_ft":1000.0,"horizontal_ft":2000.0}}},{"class":"B","floor_ft":4000.0,"ceiling_ft":10000.0,"name":"CHICAGO CLASS B","entry":"An ATC clearance.","equipment":"A Mode C transponder and ADS-B Out.","speed_kt":250,"minimums":null}],"mode_c_veil":{"ident":"KORD","distance_nm":18.5,"name":"Chicago O'Hare"},"point":{"ident":"VPBNG/095/14.2","name":"14 nm E of VPBNG","base":"VPBNG","course_deg":95,"distance_nm":14.2,"radial":false},"special_use":[{"name":"HOWARD WEST MOA","kind":"MOA","type":"MOA","floor_ft":0.0,"floor_ref":"SFC","ceiling_ft":180.0,"ceiling_ref":"STD","times_of_use":"INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE"}],"special_use_unavailable":false,"tfrs":[{"notam_id":"6/1234","active_now":true,"kind":"Stadium","title":"Soldier Field"}],"tfrs_unavailable":false}"#
        let here = try decode(AirspaceAt.self, json)
        #expect(here.bands.count == 2 && here.bands[1].airspaceClass == "B" && here.bands[1].speedKt == 250)
        #expect(here.modeCVeil?.ident == "KORD" && here.point?.ident == "VPBNG/095/14.2" && here.tfrs?.first?.activeNow == true)
        // The ground under the floor: "Surface".
        #expect(AirportWords.bandRange(here.bands[0], ground: 790) == "Surface to 1,490 ft MSL")
        #expect(AirportWords.bandRange(here.bands[1], ground: 790) == "4,000 ft to 10,000 ft MSL")
        let rules = BandRow.rules(here.bands[0])
        #expect(rules.count == 1 && rules[0].text == "VFR by day 1 sm, clear of clouds; at night 3 sm, 500 below, 1,000 above, 2,000 horizontal")
        #expect(BandRow.rules(here.bands[1]).map { $0.text } == ["An ATC clearance.", "A Mode C transponder and ADS-B Out.", "250 kt at most (91.117)"])
        #expect(AirportWords.shortAirspaceName("CHICAGO, DUPAGE AIRPORT CLASS D") == "Chicago, Dupage Airport")
        let area = try #require(here.specialUse?.first)
        #expect(AirportWords.suaAltitudes(area) == "Surface to FL2")
        #expect(AirportWords.faaWords(area.timesOfUse) == "Intermittent by NOTAM 4 hours in advance")
        #expect(AirspaceCard.tfrPage("6/1234").absoluteString.hasSuffix("detail_6_1234"))
    }

    @Test func placesWaypointsClassBPlatesAndChartPages() throws {
        struct Places: Decodable { let places: [PlaceFound] }
        let places = try decode(Places.self, #"{"places":[{"kind":"town","label":"Woodstock, IL","lat":42.31,"lon":-88.44}]}"#).places
        #expect(places[0].kind == "town")
        struct Waypoints: Decodable { let waypoints: [WaypointPin] }
        let waypoints = try decode(Waypoints.self, #"{"waypoints":[{"ident":"VPBNG","lat":42.0,"lon":-88.0,"description":"BANGS LAKE"},{"ident":"VPXYZ","lat":42.1,"lon":-88.1,"description":null}]}"#).waypoints
        #expect(waypoints[0].description == "BANGS LAKE" && waypoints[1].description == nil)
        #expect(WaypointAnnotation(waypoints[0]).subtitle == "VFR waypoint · Bangs lake")
        struct ClassB: Decodable { let airports: [ClassBAirport] }
        let fields = try decode(ClassB.self, #"{"airports":[{"ident":"KORD","name":"Chicago O'Hare Intl","lat":41.98,"lon":-87.9,"shelves":12,"flight_category":"IFR","metar":"KORD 251251Z 18010KT 2SM BR OVC006","taf":null}]}"#).airports
        let pin = MapExtras.pin(fields[0])
        #expect(pin.flightCategory == "IFR" && pin.airspaceClass == "B")
        let plate = try decode(PlateOverlay.self, #"{"cycle":"2610","name":"RNAV (GPS) RWY 24","south":42.1,"west":-88.3,"north":42.5,"east":-87.9,"circling":false,"fixes":["ANDOE"]}"#)
        #expect(plate.cycle == "2610" && plate.north > plate.south)
        struct Pages: Decodable { let pages: [ChartPage] }
        let pages = try decode(Pages.self, #"{"pages":[{"source":"dtpp","edition":"2610","pdf":"00123R24.PDF","page":0,"width":1275,"height":1650}]}"#).pages
        #expect(pages[0].path == "/api/faa-chart/page/dtpp/2610/00123R24.PDF/0.png")
    }

    // MARK: Addresses

    @Test func picturesGoThroughTheGatewayOnce() {
        let host = Config.gateway.absoluteString
        // The photos' paths are the gateway's already; the planner's own are rewritten.
        #expect(Planner.address(of: "/api/planner/airport-aerial/KDLH.jpg").absoluteString == host + "/api/planner/airport-aerial/KDLH.jpg")
        #expect(Planner.address(of: "/api/airport-diagram/2610/KDLH.png").absoluteString == host + "/api/planner/airport-diagram/2610/KDLH.png")
        #expect(Planner.diagramPath(ident: "KDLH", cycle: "2610", runwaysOnly: true) == "/api/airport-diagram/2610/runways/KDLH.png")
        #expect(Planner.platePicturePath(cycle: "2610", ident: "C81", procedure: "R24") == "/api/approach-plate/2610/C81/R24.png")
    }

    @Test func theTabsStackSaysWhatItHolds() {
        #expect(AirportRoute("KDLH") == .airport("KDLH"))
        let held = AirportRoute.airspace(lat: 42.31721, lon: -88.09054)
        #expect(AirportRoute(held.text) == held && held.heldPoint?.latitude == 42.31721)
        #expect(AirportRoute("~recents") == .list(.recents))
        let near = AirportRoute.nearFrom(lat: 42.3, lon: -88.4, label: "Woodstock, IL")
        #expect(AirportRoute(near.text) == near)
        // Not a point: a field's ident, as typed.
        #expect(AirportRoute("@nowhere") == .airport("@nowhere"))
        #expect(AirportRoute("KDLH").heldPoint == nil)
    }

    // MARK: Words

    @Test func theRadioAsPilotsSayIt() {
        let tower = AirportWords.frequencyLine(type: "TWR", description: "TWR")
        #expect(tower.name == "Tower" && tower.kind == .tower && tower.detail == nil)
        let approach = AirportWords.frequencyLine(type: "APP", description: "MINNEAPOLIS APP/DEP")
        #expect(approach.name == "Approach" && approach.detail == "Minneapolis APP/DEP")
        let odd = AirportWords.frequencyLine(type: "XYZ", description: nil)
        #expect(odd.name == "XYZ" && odd.kind == .other)
        #expect(AirportWords.mhz(120.7) == "120.7" && AirportWords.mhz(122.95) == "122.95" && AirportWords.mhz(124.475) == "124.475")
    }

    @Test func runwaysAndWind() {
        #expect(AirportWords.surfaceName("ASPH-G") == "asphalt" && AirportWords.surfaceName("Gravel/Dirt") == "gravel" && AirportWords.surfaceName(nil) == nil)
        #expect(AirportWords.runwayNumber("06") == "6" && AirportWords.runwayNumber("09L") == "9L" && AirportWords.runwayNumber("0") == "0")
        let wind = RunwayWind(end: "27", headwindKt: 10, crosswindKt: 6, gustCrosswindKt: 9, inUse: true)
        #expect(AirportWords.runwayWind(wind) == "Favors 27: 10 kt headwind, 6 kt crosswind from the right, 9 in the gusts")
        let tail = RunwayWind(end: "09", headwindKt: -3, crosswindKt: -2, gustCrosswindKt: nil, inUse: nil)
        #expect(AirportWords.runwayWind(tail) == "Favors 09: 3 kt tailwind, 2 kt crosswind from the left")
        #expect(AirportWords.runwayWind(RunwayWind(end: "18", headwindKt: 0, crosswindKt: 0)) == "Calm on 18")
        var runway = Runway(ends: "06/24", lengthFt: 3700, surface: "TURF", lighted: true)
        runway.runwayEnds = [RunwayEnd(ident: "06", traffic: "left"), RunwayEnd(ident: "24", traffic: "right")]
        #expect(AirportWords.runwayDetail(runway) == "turf · lighted · right traffic 24")
        #expect(AirportWords.windLine(dirTrueDeg: 0, speedKt: 12, gustKt: 20) == "360° at 12 kt, gusts 20")
        #expect(AirportWords.windLine(dirTrueDeg: nil, speedKt: 4, gustKt: nil) == "Variable at 4 kt")
        #expect(AirportWords.windLine(dirTrueDeg: 250, speedKt: 0, gustKt: nil) == "Calm")
        #expect(AirportWords.windLine(dirTrueDeg: nil, speedKt: nil, gustKt: nil) == "Not reported")
    }

    @Test func figuresAndTimes() {
        #expect(AirportWords.grouped(10162) == "10,162" && AirportWords.grouped(1234567) == "1,234,567" && AirportWords.grouped(500) == "500")
        #expect(AirportWords.feet(1428) == "1,428 ft" && AirportWords.feet(nil) == "—")
        #expect(AirportWords.compassPoint(44) == "NE" && AirportWords.compassPoint(350) == "N" && AirportWords.compassPoint(-90) == "W")
        #expect(AirportWords.degreesMinutes(lat: 42.3172, lon: -88.0905) == "N42°19.0′ W088°05.4′")
        // 59.96 minutes is the next degree, never 60.0.
        #expect(AirportWords.degreesMinutes(lat: 42.99994, lon: 0) == "N43°00.0′ E000°00.0′")
        let at = AirportWords.date("2026-10-25T12:55:00Z")!
        #expect(AirportWords.observed("2026-10-25T12:55:00Z", now: at.addingTimeInterval(14 * 60)) == "1255Z · 14 min ago")
        #expect(AirportWords.observed("2026-10-25T12:55:00.000Z", now: at) == "1255Z · just now")
        #expect(AirportWords.observed("not a time") == nil)
        #expect(AirportWords.faaWords("CHICAGO CLASS B. ACTIVE MON-FRI") == "Chicago Class B. Active Mon-Fri")
        #expect(AirportWords.faaWords("Already written") == "Already written")
        #expect(AirportWords.minimumsLine(VfrMinimums(visibilitySm: 3, clearOfClouds: false, belowFt: 500, aboveFt: 1000, horizontalFt: 5280)) == "3 sm, 500 below, 1,000 above, 1 sm horizontal")
    }

    @Test func chartsInTheirGroups() {
        let charts = [
            TerminalChart(kind: "APD", name: "AIRPORT DIAGRAM", url: "a"), TerminalChart(kind: "IAP", name: "ILS RWY 27", url: "b"),
            TerminalChart(kind: "ODP", name: "TAKEOFF MINIMUMS", url: "c"), TerminalChart(kind: "XYZ", name: "SOMETHING", url: "d"),
            TerminalChart(kind: "HOT", name: "HOT SPOT", url: "e"),
        ]
        let groups = AirportChartsTab.grouped(charts)
        #expect(groups.map(\.title) == ["Approaches", "Departures", "Other"])
        #expect(groups.last?.charts.map(\.url) == ["d"])
    }

    @Test func aMilitaryFieldIsOneToKeepOutOf() {
        var place = AirportPlace(ident: "KSKF", name: "Kelly Field", lat: 29.38, lon: -98.58, kind: "large")
        place.military = "military"
        #expect(AirportHead.restriction(place) == "Military, permission required")
        place.military = nil
        place.`private` = true
        #expect(AirportHead.restriction(place) == "Private, permission required")
        place.metar = Metar(flightCategory: "IFR")
        #expect(AirportHead.category(place)?.own == true)
    }

    // MARK: The map

    @Test func theWebMapsZoom() {
        // The whole world across 256 points is zoom 0; half of it, zoom 1.
        #expect(MapExtras.zoom(longitudeDelta: 360, width: 256) == 0)
        #expect(abs(MapExtras.zoom(longitudeDelta: 180, width: 256) - 1) < 1e-9)
        #expect(MapExtras.zoom(longitudeDelta: 1.0, width: 390) > MapExtras.waypointsFromZoom)
        #expect(MapExtras.zoom(longitudeDelta: 0, width: 390) == 0)
    }

    // MARK: Favorites and Recents

    @Test func favoritesAndRecentsAreKeptOnTheDevice() throws {
        let suite = "AirportExtrasTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let shelf = AirportShelf(defaults: defaults)
        let dlh = KeptAirport(ident: "KDLH", name: "Duluth Intl", municipality: "Duluth", lat: 46.84, lon: -92.19)
        let c81 = KeptAirport(ident: "C81", name: "Campbell", lat: 42.32, lon: -88.07)
        shelf.toggleFavorite(dlh)
        shelf.toggleFavorite(c81)
        #expect(shelf.isFavorite("KDLH") && shelf.favorites.map(\.ident) == ["KDLH", "C81"])
        shelf.moveFavorites(from: IndexSet(integer: 1), to: 0)
        #expect(shelf.favorites.map(\.ident) == ["C81", "KDLH"])
        shelf.toggleFavorite(dlh)
        #expect(!shelf.isFavorite("KDLH"))
        shelf.opened(dlh)
        shelf.opened(c81)
        shelf.opened(dlh)
        #expect(shelf.recents.map(\.ident) == ["KDLH", "C81"])
        for n in 0..<30 { shelf.opened(KeptAirport(ident: "X\(n)", name: "X", lat: 0, lon: 0)) }
        #expect(shelf.recents.count == AirportShelf.recentsKept && shelf.recents.first?.ident == "X29")
        shelf.show(.recents)
        // Read back by another shelf on the same store, as the app opened again.
        let again = AirportShelf(defaults: defaults)
        #expect(again.favorites.map(\.ident) == ["C81"] && again.recents.count == AirportShelf.recentsKept && again.shows == .recents)
        again.clearRecents()
        #expect(AirportShelf(defaults: defaults).recents.isEmpty)
    }
}
