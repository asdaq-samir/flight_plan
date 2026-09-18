// esri-leaflet ships its own ESM source with no bundled .d.ts, and
// @types/esri-leaflet only types the legacy `L.esri.*` global-script-tag
// API (the one its own README's CDN quick-start uses) -- a Vite build
// importing named exports from "esri-leaflet" directly never touches
// that global at all. Declared here instead: just the one export this
// app actually calls, typed against DynamicMapLayer's real options
// (src/Layers/DynamicMapLayer.js and its RasterLayer base), not guessed.
declare module "esri-leaflet" {
  import type { Layer, LayerOptions } from "leaflet";

  interface DynamicMapLayerOptions extends LayerOptions {
    url: string;
    format?: string;
    transparent?: boolean;
    // "json" (the DynamicMapLayer default) asks for a JSON export
    // response naming a second, actual image URL; "image" requests
    // that image directly. See the f: "image" call site's own comment.
    f?: "json" | "image";
    // RasterLayer's own options, not Leaflet's GridLayer ones (Leaflet's
    // own LayerOptions type doesn't declare these) -- RasterLayer reads
    // them directly (src/Layers/RasterLayer.js's own _update) to skip
    // rendering outside this range, the same "hide past a limit" role
    // GridLayer's minZoom/maxZoom play for a plain L.tileLayer.
    minZoom?: number;
    maxZoom?: number;
  }

  export function dynamicMapLayer(options: DynamicMapLayerOptions): Layer;
}
