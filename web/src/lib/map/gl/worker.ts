import { setWorkerUrl } from "maplibre-gl";
// The worker MapLibre parses its sources in: a file of its own, which a
// bundle cannot find beside maplibre-gl.mjs as the library looks for it
// (beside its own module's address). Imported once by every map.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);
