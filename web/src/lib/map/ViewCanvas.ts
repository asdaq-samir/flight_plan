import L from "leaflet";

/** How far round the view the canvas reaches, a share of it each side:
 *  a pan shows what is drawn there already as it starts, redrawn when it
 *  ends. */
const PAD = 0.25;
/** The most device pixels a CSS pixel is drawn at: a phone's 3 made a
 *  padded canvas 30 MB. */
const MOST_DPR = 2;

/** What one drawing covers, given to a layer's paint: its context is set
 *  so that x and y are the map container's own points (0, 0 the view's
 *  top left), and it reaches `pad` past the view each side. */
export interface CanvasView {
  map: L.Map;
  /** The view's size, in points. */
  size: L.Point;
  pad: L.Point;
  /** The canvas's top left in the map's layer points. */
  origin: L.Point;
  /** The canvas's top left in the container's points (-pad). */
  from: L.Point;
  /** Device pixels to a point on this canvas. */
  dpr: number;
}

/**
 * A canvas the size of the view (and PAD round it) that a layer paints
 * on, kept on the chart as Leaflet keeps its own canvas: moved with the
 * map in its pane, scaled with it through a zoom's animation and a pinch,
 * and drawn again as each move or zoom ends -- or under a pan, as the
 * view nears the edge of what was drawn. Never larger than the screen
 * however far in the map is zoomed, where an element placed on the map
 * (an ImageOverlay's <img>, a marker) grows with it: the approach plate's
 * picture was 19,000 points wide at zoom 15 (PlateLayer).
 */
export abstract class ViewCanvasLayer extends L.Layer {
  protected canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private topLeft: L.LatLng | null = null;
  /** The zoom the drawing is for. */
  private drawnZoom = 0;
  /** What the last drawing covers, in the map's layer points. */
  private drawn: L.Bounds | null = null;

  constructor(pane: string, private readonly className = "") {
    super();
    // Leaflet's classes take their options in initialize, which an ES
    // subclass's constructor does not reach: set here, or it is the
    // overlay pane's, under the selected field's ring.
    L.setOptions(this, { pane });
  }

  /** The layer's own drawing, on a cleared canvas. */
  protected abstract paint(ctx: CanvasRenderingContext2D, view: CanvasView): void;

  onAdd(map: L.Map): this {
    const canvas = L.DomUtil.create("canvas", `leaflet-zoom-animated ${this.className}`.trim(), map.getPane(this.options.pane!));
    canvas.style.pointerEvents = "none";
    this.canvas = canvas;
    // Drawn again through a pan too, a frame at a time: past the canvas's
    // edge a long pan's airport marks came in only as it ended.
    map.on("resize viewreset", this.schedule, this);
    map.on("moveend", this.ended, this);
    map.on("zoom", this.zoomed, this);
    map.on("move", this.moved, this);
    map.on("zoomanim", this.animate, this);
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("resize viewreset", this.schedule, this);
    map.off("moveend", this.ended, this);
    map.off("zoom", this.zoomed, this);
    map.off("move", this.moved, this);
    map.off("zoomanim", this.animate, this);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  /** Under a finger's pan the canvas moves with the map's pane already:
   *  drawn again only once the view nears the edge of what was drawn (its
   *  PAD round the screen), not at every frame -- the redraws were most of
   *  a pan's main-thread time on a phone (measured 2026-10-26: drawImage
   *  and the labels 400 ms of a 20-step pan at 4x throttle). As it comes
   *  to rest it is drawn again in full (moveend). */
  private moved(): void {
    const map = this._map;
    if (!map || !this.drawn) return this.schedule();
    const size = map.getSize();
    const margin = size.multiplyBy(PAD / 2);
    const tl = map.containerPointToLayerPoint(L.point(0, 0)).subtract(margin);
    const br = map.containerPointToLayerPoint(size).add(margin);
    if (!this.drawn.contains(tl) || !this.drawn.contains(br)) this.schedule();
  }

  /** A move ended: drawn again only where it left what was drawn, or the
   *  zoom changed. A map following an airplane -- own ship, a dry run's --
   *  ends a small move several times a second, and the whole canvas was
   *  drawn again at each: 56 to 250 ms of three seconds of a dry run at
   *  200x, 4x a phone's (2026-10-29). */
  private ended(): void {
    if (this._map?.getZoom() !== this.drawnZoom) return this.schedule();
    this.moved();
  }

  /** Drawn again at the next frame, once however often asked. */
  protected schedule(): void {
    if (this.frame || !this.canvas) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** At each step of a pinch (or a flight's zoom), the drawing kept on
   *  the chart at once -- moved and scaled to where the map now puts it,
   *  as Leaflet keeps its own canvas -- and drawn again at the next frame.
   *  Drawn again only, the marks were a step behind the chart in every
   *  other frame and back with it in the next, and shook through a pinch:
   *  the owner, 2026-10-27, "When I zoom in they seem to be vibrating"
   *  (phone project, a pinch in over KATW: the mark 3-4 chart pixels off
   *  and back, frame after frame; the route's own markers 0.3). */
  private zoomed(): void {
    const map = this._map;
    if (map && this.canvas && this.topLeft) {
      const zoom = map.getZoom();
      const at = map.project(this.topLeft, zoom).subtract(map.getPixelOrigin());
      L.DomUtil.setTransform(this.canvas, at, map.getZoomScale(zoom, this.drawnZoom));
    }
    this.schedule();
  }

  /** Through a zoom's animation the canvas scaled and moved where the map
   *  will be, as Leaflet's own layers are; drawn again as it ends. */
  private animate(e: L.ZoomAnimEvent): void {
    const map = this._map as L.Map & { _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point };
    if (!this.canvas || !this.topLeft) return;
    const scale = map.getZoomScale(e.zoom, map.getZoom());
    L.DomUtil.setTransform(this.canvas, map._latLngToNewLayerPoint(this.topLeft, e.zoom, e.center), scale);
  }

  private draw(): void {
    const map = this._map;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const pad = size.multiplyBy(PAD).round();
    const from = L.point(-pad.x, -pad.y);
    const width = size.x + 2 * pad.x, height = size.y + 2 * pad.y;
    this.topLeft = map.containerPointToLatLng(from);
    this.drawnZoom = map.getZoom();
    const origin = map.containerPointToLayerPoint(from);
    L.DomUtil.setPosition(canvas, origin);
    this.drawn = L.bounds(origin, origin.add(L.point(width, height)));
    const dpr = Math.min(window.devicePixelRatio || 1, MOST_DPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, pad.x * dpr, pad.y * dpr);
    ctx.clearRect(-pad.x, -pad.y, width, height);
    this.paint(ctx, { map, size, pad, origin, from, dpr });
  }
}
