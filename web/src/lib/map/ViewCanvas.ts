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

/**
 * A canvas taken off the map kept for the next layer drawn in the same pane
 * with the same classes, blank and with nothing written on it, rather than
 * let go: the VORs' and the altitudes' layers are made again each time the
 * map zooms in past 8 (NavaidsLayer, AirspaceLayer), and a new canvas's
 * first drawing gave it its memory, 17 ms each on the phone viewport at CPU
 * 4x, 34 ms of a zoom from 7 to 9 (a profile, 2026-11-04; the owner, "make
 * it fast but stable"), and four times the pixels at a phone's 2x. One for
 * each, the most the map would have in use at once anyway.
 */
const spares = new Map<string, HTMLCanvasElement>();

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
  /** A drawing asked for while Leaflet animated a zoom, owed as it ends. */
  private deferred = false;
  /** Which spare canvas this layer's is (spares). */
  private spareKey = "";

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
    // Leaflet's stylesheet eases every .leaflet-zoom-animated element's
    // transform over a quarter second while the map pane is
    // .leaflet-zoom-anim, which it is from the moment a pinch's fingers
    // lift (TouchZoom._onTouchEnd calls _animateZoom even where pinch.ts
    // leaves the zoom as it is). A layer drawn again at each frame places
    // its canvas with a plain transform at once (draw), and under that
    // ease the canvas, scaled at the pinch's last frame to a drawing a
    // level or more behind (zoomed), grew or shrank to scale 1 over the
    // quarter second with its fresh drawing on it: the rings a third
    // smaller than the chart as the fingers lifted and growing to size
    // (the owner's recording, 2026-11-03 18:13, "rings jump out when
    // zoomed out really fast"). Such a layer takes no ease: it draws
    // where the chart is at every frame itself (step, warp).
    const eased = this.redrawWhileZooming ? "" : "leaflet-zoom-animated";
    const classes = `${eased} ${this.className}`.trim();
    this.spareKey = `${this.options.pane}|${classes}`;
    const pane = map.getPane(this.options.pane!)!;
    const spare = spares.get(this.spareKey);
    spares.delete(this.spareKey);
    const canvas = spare ?? L.DomUtil.create("canvas", classes);
    pane.appendChild(canvas);
    canvas.style.pointerEvents = "none";
    // The class also set the canvas's transform origin to its top left,
    // which a pinch's scale (zoomed) is about: without it a canvas scaled
    // about its centre, and the rings slid against the chart at every
    // other frame of a pinch (the owner, 2026-11-03: "now it's moving
    // while zoom"). Set on the canvas itself, class or no class.
    canvas.style.transformOrigin = "0 0";
    this.canvas = canvas;
    // Drawn again through a pan too, a frame at a time: past the canvas's
    // edge a long pan's airport marks came in only as it ended.
    map.on("resize viewreset", this.reset, this);
    map.on("moveend", this.ended, this);
    map.on("zoom", this.zoomed, this);
    map.on("move", this.moved, this);
    map.on("zoomanim", this.animate, this);
    map.on("zoomend", this.animated, this);
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("resize viewreset", this.reset, this);
    map.off("moveend", this.ended, this);
    map.off("zoom", this.zoomed, this);
    map.off("move", this.moved, this);
    map.off("zoomanim", this.animate, this);
    map.off("zoomend", this.animated, this);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const canvas = this.canvas;
    this.canvas = null;
    if (canvas) {
      canvas.remove();
      // Kept blank, with nothing written on it for the tests, as a new one
      // would be: the next layer's first drawing is where it is placed.
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      for (const key of Object.keys(canvas.dataset)) delete canvas.dataset[key];
      if (this.spareKey && !spares.has(this.spareKey)) spares.set(this.spareKey, canvas);
    }
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
    this.place();
    const zooming = map.getZoom() !== this.drawnZoom;
    if (!this.covers(zooming ? L.point(0, 0) : map.getSize().multiplyBy(PAD / 2))) this.schedule();
  }

  /** The view's size or its pixel origin changed (a phone's toolbar going,
   *  Leaflet's view reset): the canvas put back on the chart at once and
   *  drawn again at the next frame. */
  private reset(): void {
    this.place();
    this.schedule();
  }

  /**
   * The drawing put where the map now has the place its top left was drawn
   * for -- a no-op while the map's pixel origin and the pane hold, as
   * through a plain pan. Where Leaflet moves its pixel origin under a pan
   * (a view reset, a resize as Safari's toolbar comes and goes), the
   * canvas, placed in the old layer points, stood off the chart until the
   * next frame drew it again, and under a busy main thread for several:
   * the rings, their altitudes and the airports' marks jumped against the
   * chart and settled back as the finger moved (the owner's recording,
   * 2026-11-04 22:11, a pan over Rockford: "class b rings dragging as I
   * move"; the chart still while the marks moved 50 points between two
   * frames).
   */
  private place(): void {
    const map = this._map as (L.Map & { _animatingZoom?: boolean }) | undefined;
    if (!map || !this.canvas || !this.topLeft || map._animatingZoom) return;
    const zoom = map.getZoom();
    const at = map.project(this.topLeft, zoom).subtract(map.getPixelOrigin());
    L.DomUtil.setTransform(this.canvas, at, map.getZoomScale(zoom, this.drawnZoom));
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
    // Scaled from the zoom the drawing is for, not the map's: as a pinch's
    // fingers lift, Leaflet animates from the pinch's own zoom (pinch.ts,
    // no snap), where the canvas, drawn before the pinch and scaled with
    // it since, was set back to scale 1 under the stylesheet's transition
    // -- the rings shrank towards the canvas's top left for a quarter
    // second after a pinch in, grew out of it after a pinch out, and
    // jumped back as the redraw came (the owner, 2026-11-03: "when zooming
    // in, the rings slide from top left and when zooming out, the rings
    // slide from bottom right"; Session1's probe, scale 2.44 to 1 over
    // three frames, the canvas 1474 to 626 points wide on screen, then
    // drawn again at 604).
    const scale = map.getZoomScale(e.zoom, this.drawnZoom);
    L.DomUtil.setTransform(this.canvas, map._latLngToNewLayerPoint(this.topLeft, e.zoom, e.center), scale);
  }

  /** A frame of a zoom's animation drawn, and the next asked for until it
   *  has run its time; the map's zoomend draws it at the new zoom. */
  private step(): void {
    this.draw();
    const zooming = this.zoomingTo;
    if (zooming && performance.now() - zooming.start < ZOOM_MS) {
      // The next step draws the next frame, so a drawing the paint just
      // asked for (a mark still fading in, fadeIn) is let go. Kept, it was
      // lost from `frame` under the step's own and went on by itself,
      // drawing and asking again at every frame while the fade ran: a zoom
      // with a mark fading in drew the whole canvas once more at each frame
      // of its animation than at the one before, 17 times in one frame by
      // its end, and so on until the fade was over (ViewCanvas.test).
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.step();
      });
    }
  }

  private animated(): void {
    if (this.deferred) {
      this.deferred = false;
      this.schedule();
    }
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
    // Not while Leaflet animates a zoom (a double tap, a wheel's step, a
    // fitted route; _animatingZoom, the pane's .leaflet-zoom-anim), for a
    // layer scaled through it (animate): drawn then, the canvas is placed
    // for the zoom the map still has, a plain translate, and the
    // stylesheet transitions it there from where the animation had it
    // over the animation's own 0.25 s -- a plate fetched mid-animation, or
    // a redraw the sheet's follow ends with, glided across the screen
    // (Session1's probe, 2026-11-03: the airspace's canvas placed under the
    // animation in 4 of 14 frames of a zoom from 5 to 7 over KOKC, the
    // owner's recording of Dallas's Class B carried past KOKC and back).
    // Owed instead, and drawn as the zoom ends (animated).
    if (!this.redrawWhileZooming && (map as L.Map & { _animatingZoom?: boolean })._animatingZoom) {
      this.deferred = true;
      return;
    }
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
