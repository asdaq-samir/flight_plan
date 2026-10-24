import Foundation
import MapKit

/// The FAA chart as the map's ground: an MKTileOverlay that replaces
/// Apple's map (no other base map, as the web app has none) and answers
/// each tile from the store on disk before the network, keeping what it
/// fetches.
final class ChartTileOverlay: MKTileOverlay {
    let template: TileTemplate
    let store: TileStore
    private let session = URLSession(configuration: .default)

    init(template: TileTemplate, minZoom: Int, maxZoom: Int, store: TileStore = .shared) {
        self.template = template
        self.store = store
        super.init(urlTemplate: nil)
        canReplaceMapContent = true
        tileSize = CGSize(width: 256, height: 256)
        minimumZ = minZoom
        maximumZ = maxZoom
    }

    override func url(forTilePath path: MKTileOverlayPath) -> URL {
        template.url(z: path.z, x: path.x, y: path.y)
    }

    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, (any Error)?) -> Void) {
        let (z, x, y) = (path.z, path.x, path.y)
        if let kept = store.read(cycle: template.cycle, kind: template.kind, z: z, x: x, y: y) {
            result(kept, nil)
            return
        }
        let store = store, template = template
        session.dataTask(with: url(forTilePath: path)) { data, response, error in
            if let data, (response as? HTTPURLResponse)?.statusCode == 200 {
                store.write(data, cycle: template.cycle, kind: template.kind, z: z, x: x, y: y)
                result(data, nil)
            } else {
                // A tile the chart has none of (the sea, past the
                // country's edge) stays blank; no error on the map.
                result(nil, error)
            }
        }.resume()
    }
}
