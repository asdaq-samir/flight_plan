import CoreLocation
import Foundation
import Testing
@testable import Wingtip

/// The tile addresses and the store, as the web app's tiles.test.ts pins
/// them: a CDN edition by path, the planner's by query, the revision on
/// both.
struct TilesTests {
    @Test func cdnTilesCarryTheCycleAsAPathSegment() {
        let t = TileTemplate(cycle: "09-03-2026", revision: 2, tilesBase: "https://tiles.example.com/tiles", kind: "sec")
        #expect(t.url(z: 8, x: 62, y: 93).absoluteString == "https://tiles.example.com/tiles/09-03-2026/sec/8/62/93.png?r=2")
    }

    @Test func plannerTilesGoThroughTheGatewayWithTheCycleAsAQuery() {
        let t = TileTemplate(cycle: "09-03-2026", revision: 0, tilesBase: nil, kind: "sec")
        let url = t.url(z: 8, x: 62, y: 93)
        #expect(url.host() == Config.host)
        #expect(url.path() == "/api/planner/chart-tile/sec/8/62/93.png")
        #expect(url.query() == "c=09-03-2026&r=0")
    }

    @Test func plannerPathsAreRewrittenUnderTheGatewaysProxy() {
        #expect(Config.plannerPath("/api/chart") == "/api/planner/chart")
        #expect(Config.plannerPath("/api/airport/KDLH") == "/api/planner/airport/KDLH")
        #expect(Config.plannerPath("/logout") == "/logout")
    }

    @Test func theStoreKeepsATileByCycleKindAndPathAndDropsOtherEditions() throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "tiles-\(UUID().uuidString)")
        let store = TileStore(root: root)
        store.write(Data([1, 2, 3]), cycle: "09-03-2026", kind: "sec", z: 8, x: 62, y: 93)
        store.write(Data([4]), cycle: "07-10-2026", kind: "sec", z: 8, x: 62, y: 93)
        #expect(store.read(cycle: "09-03-2026", kind: "sec", z: 8, x: 62, y: 93) == Data([1, 2, 3]))
        #expect(store.bytes() == 4)
        store.keepOnly(cycle: "09-03-2026")
        #expect(store.read(cycle: "07-10-2026", kind: "sec", z: 8, x: 62, y: 93) == nil)
        #expect(store.bytes() == 3)
        try? FileManager.default.removeItem(at: root)
    }
}

/// The tiles a route's corridor needs, the web map's own arithmetic.
struct KeepRouteTests {
    @Test func aPointFallsInTheTileTheWebMapAsksFor() {
        // Campbell (C81) at zoom 8: x 65, y 94, as the web map addresses it.
        let t = KeepRoute.tile(lat: 42.3246, lon: -88.0741, zoom: 8)
        #expect(t.x == 65 && t.y == 94)
    }

    @Test func aShortRouteWantsAFewTilesAtEachZoomAndMoreAtTheFiner() {
        let line = [CLLocationCoordinate2D(latitude: 42.32, longitude: -88.07), CLLocationCoordinate2D(latitude: 42.42, longitude: -87.87)]
        let coarse = KeepRoute.tiles(along: line, minZoom: 7, maxZoom: 7)
        let fine = KeepRoute.tiles(along: line, minZoom: 10, maxZoom: 10)
        #expect(coarse.count >= 9 && coarse.count <= 16)
        #expect(fine.count > coarse.count)
        #expect(KeepRoute.tiles(along: [line[0]], minZoom: 7, maxZoom: 10).isEmpty)
    }
}
