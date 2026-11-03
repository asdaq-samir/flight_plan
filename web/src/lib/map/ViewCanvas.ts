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
  /** Where a point of this drawing is at this frame of a zoom's
   *  animation, for a layer whose marks keep their size through it
   *  (redrawWhileZooming): the identity but while one runs. */
  warp: (at: L.Point) => L.Point;
}

const SAME = (at: L.Point) => at;

/** Leaflet's zoom animation as its stylesheet times it (.leaflet-zoom-anim
 *  .leaflet-zoom-animated: transform 0.25s cubic-bezier(0, 0, 0.25, 1)),
 *  so that marks drawn at each frame of it move with the chart's tiles. */
const ZOOM_MS = 250;
function zoomEase(x: number): number {
  // The curve's x and y for a parameter t; its first control point is at
  // (0, 0) and its second at (0.25, 1).
  const bx = (t: number) => 3 * (1 - t) * t * t * 0.25 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * t * t + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
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
  /** The last drawing was made under a pinch: drawn again at rest. */
  private drawnMoving = false;
  /** The zoom being animated to, and when it started, while one is. */
  private zoomingTo: { zoom: number; center: L.LatLng; start: number } | null = null;

  /** Drawn again at each step of a pinch (the airports' marks, which must
   *  stay sharp and placed as the chart grows), or only once it ends,
   *  scaled with the chart meanwhile, as Leaflet's own canvas is: a plate's
   *  picture, whose every redraw was a large drawImage at high quality and
   *  the map under a finger stuttered with one on it (the owner,
   *  2026-11-02: "Why is the map so touchy when the procedure plate is
   *  overlayed?"). */
  protected redrawWhileZooming = true;

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
    map.on("zoomend", this.animated, this);
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("resize viewreset", this.schedule, this);
    map.off("moveend", this.ended, this);
    map.off("zoom", this.zoomed, this);
    map.off("move", this.moved, this);
    map.off("zoomanim", this.animate, this);
    map.off("zoomend", this.animated, this);
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
   *  to rest it is drawn again in full (moveend). Under a pinch the canvas
   *  is scaled with the chart (zoomed), and what it covers is judged
   *  scaled: judged by the layer's points at the zoom it was drawn for, a
   *  pinch drew the plate again at nearly every frame, and a pinch out
   *  showed its edge, the plate cut off, before it was drawn again. */
  private moved(): void {
    const map = this._map;
    if (!map || !this.topLeft) return this.schedule();
    const zooming = map.getZoom() !== this.drawnZoom;
    if (!this.covers(zooming ? L.point(0, 0) : map.getSize().multiplyBy(PAD / 2))) this.schedule();
  }

  /** Whether what was drawn, where the map now has it, reaches `margin`
   *  past every side of the screen. */
  private covers(margin: L.Point): boolean {
    const map = this._map!;
    const size = map.getSize();
    const scale = map.getZoomScale(map.getZoom(), this.drawnZoom);
    const pad = size.multiplyBy(PAD).round();
    const tl = map.latLngToContainerPoint(this.topLeft!);
    const br = tl.add(L.point(size.x + 2 * pad.x, size.y + 2 * pad.y).multiplyBy(scale));
    return tl.x <= -margin.x && tl.y <= -margin.y && br.x >= size.x + margin.x && br.y >= size.y + margin.y;
  }

  /** A move ended: drawn again only where it left what was drawn, or the
   *  zoom changed. A map following an airplane -- own ship, a dry run's --
   *  ends a small move several times a second, and the whole canvas was
   *  drawn again at each: 56 to 250 ms of three seconds of a dry run at
   *  200x, 4x a phone's (2026-10-29). */
  private ended(): void {
    if (this._map?.getZoom() !== this.drawnZoom || this.drawnMoving) return this.schedule();
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
    if (this.redrawWhileZooming) this.schedule();
    else this.moved();
  }

  /** Through a zoom's animation (a wheel's step, a double tap, a fitted
   *  route) the canvas scaled and moved where the map will be, as
   *  Leaflet's own layers are, and drawn again as it ends -- or, for marks
   *  that keep their size (redrawWhileZooming), drawn at each frame where
   *  the chart then is, their size kept. Scaled, the airports' marks and
   *  idents grew to twice their size through each step in and shrank to
   *  half through each step out, and a trackpad's run of steps kept them
   *  so: the owner's recording (2026-11-02, a Mac), KCLT's mark and ident
   *  twice their size through a zoom in on Charlotte and specks through
   *  the zoom back out. */
  private animate(e: L.ZoomAnimEvent): void {
    const map = this._map as L.Map & { _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point };
    if (!this.canvas || !this.topLeft) return;
    if (this.redrawWhileZooming) {
      this.zoomingTo = { zoom: e.zoom, center: e.center, start: performance.now() };
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.step();
      return;
    }
    const scale = map.getZoomScale(e.zoom, map.getZoom());
    L.DomUtil.setTransform(this.canvas, map._latLngToNewLayerPoint(this.topLeft, e.zoom, e.center), scale);
  }

  /** A frame of a zoom's animation drawn, and the next asked for until it
   *  has run its time; the map's zoomend draws it at the new zoom. */
  private step(): void {
    this.draw();
    const zooming = this.zoomingTo;
    if (zooming && performance.now() - zooming.start < ZOOM_MS) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.step();
      });
    }
  }

  private animated(): void {
    if (!this.zoomingTo) return;
    this.zoomingTo = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw();
  }

  /** Where a point of a drawing at the map's present zoom is at this frame
   *  of the animation: Leaflet's transform for the canvas (moved to where
   *  its corner will be, scaled by the zoom's change), eased as its
   *  stylesheet eases it, applied to where the point is and not to the
   *  mark's size. */
  private warpOf(origin: L.Point, pad: L.Point): (at: L.Point) => L.Point {
    const map = this._map as L.Map & { _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point };
    const zooming = this.zoomingTo;
    if (!zooming || !this.topLeft) return SAME;
    const p = zoomEase(Math.min(1, (performance.now() - zooming.start) / ZOOM_MS));
    const scale = 1 + (map.getZoomScale(zooming.zoom, map.getZoom()) - 1) * p;
    const shift = map._latLngToNewLayerPoint(this.topLeft, zooming.zoom, zooming.center).subtract(origin).multiplyBy(p);
    return at => at.add(pad).multiplyBy(scale).add(shift).subtract(pad);
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
    this.drawnMoving = !!(map as L.Map & { touchZoom?: { _zooming?: boolean } }).touchZoom?._zooming;
    const origin = map.containerPointToLayerPoint(from);
    L.DomUtil.setPosition(canvas, origin);
    const dpr = Math.min(window.devicePixelRatio || 1, MOST_DPR);
    // Resized only when the view's size changed: setting a canvas's size,
    // even to the same, gives it new memory, at every redraw of a pan.
    const deviceWidth = Math.round(width * dpr), deviceHeight = Math.round(height * dpr);
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, pad.x * dpr, pad.y * dpr);
    ctx.clearRect(-pad.x, -pad.y, width, height);
    this.paint(ctx, { map, size, pad, origin, from, dpr, warp: this.warpOf(origin, pad) });
  }
}
