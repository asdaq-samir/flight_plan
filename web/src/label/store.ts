import { create } from "zustand";
import { api } from "../api/client";
import type { Course, Detection, Endpoint, LoosePick, Point, Rating } from "../api/types";
import { DEFAULT_FILTERS, FILTER_KEYS, type FilterKey, type Filters } from "./logic";

/**
 * All the labeling view's state, in one place.
 *
 * The point of a store here is not tidiness -- it is that every count on
 * screen is *derived* from this rather than tracked alongside it. The
 * page this replaces kept a `judged` flag beside the rating it came from,
 * a summary the server sent beside counts computed locally, and a walk
 * numbered over a different set than the banner counted. Each of those
 * was one fact with two owners, and each drifted.
 */

export interface Selection {
  kind: "endpoint" | "detected" | "added";
  index: number;
}

interface LabelState {
  course: Course | null;
  endpoints: Endpoint[];
  detections: Detection[];
  added: LoosePick[];
  filters: Filters;
  selection: Selection | null;
  /** Where the walk was last, so Space can come back to it after a rating
   *  has cleared the selection. */
  lastFocus: Selection | null;
  loading: boolean;
  progress: string | null;
  error: string | null;

  load: (dep: string, dest: string) => Promise<void>;
  setFilter: (key: FilterKey, on: boolean) => void;
  select: (selection: Selection | null) => void;
  rate: (rating: Rating) => Promise<void>;
  addPick: (lat: number, lon: number, category: string) => Promise<void>;
  removeSelected: () => Promise<void>;
}

const STORAGE_KEY = "vfr.filters";

function savedFilters(): Filters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    const merged = { ...DEFAULT_FILTERS };
    for (const key of FILTER_KEYS) if (key in parsed) merged[key] = !!parsed[key];
    return merged;
  } catch {
    return DEFAULT_FILTERS;   // private window, or storage refused
  }
}

export const useLabelStore = create<LabelState>((set, get) => ({
  course: null,
  endpoints: [],
  detections: [],
  added: [],
  filters: savedFilters(),
  selection: null,
  lastFocus: null,
  loading: false,
  progress: null,
  error: null,

  async load(dep, dest) {
    set({ loading: true, error: null, detections: [], added: [], selection: null });
    let course: Course;
    try {
      course = await api.course(dep, dest);
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      return;
    }
    // The ends of the leg exist the moment the course does, so they are
    // on screen before a single tile has been read.
    set({
      course,
      endpoints: [
        { endpoint: true, ident: course.departure.ident, name: course.departure.name,
          lat: course.departure.lat, lon: course.departure.lon,
          along_track_nm: 0, category: "departure" },
        { endpoint: true, ident: course.destination.ident, name: course.destination.name,
          lat: course.destination.lat, lon: course.destination.lon,
          along_track_nm: course.distance_nm, category: "destination" },
      ],
    });

    try {
      for await (const msg of api.detect(dep, dest)) {
        if (msg.type === "block") {
          const pct = msg.blocks ? Math.round(((msg.block + 1) / msg.blocks) * 100) : 0;
          set(s => ({
            detections: s.detections.concat(msg.detections),
            progress: `Reading the chart ${pct}%`,
          }));
        } else if (msg.type === "done") {
          // Picks no detection claimed arrive last: a later block might
          // still have claimed one, so it cannot be known any earlier.
          set({ added: msg.added, progress: null, loading: false });
        }
      }
    } catch (err) {
      set({ loading: false, progress: null, error: (err as Error).message });
    }
  },

  setFilter(key, on) {
    const filters = { ...get().filters, [key]: on };
    set({ filters });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch { /* refused */ }
  },

  select(selection) {
    set(s => ({ selection, lastFocus: selection ?? s.lastFocus }));
  },

  async rate(rating) {
    const { course, selection } = get();
    if (!course || !selection || selection.kind === "endpoint") return;
    const point = currentPoint(get());
    if (!point) return;

    const saved = await api.savePick({
      departure_ident: course.departure.ident,
      destination_ident: course.destination.ident,
      lat: point.lat, lon: point.lon,
      source: selection.kind === "added" ? "added" : "detected",
      category: (point as Detection).category,
      rating,
      area_m2: (point as Detection).area_m2 ?? null,
    });

    // Write the rating back; everything shown about it is derived from
    // this one field, so nothing else needs updating in step.
    set(s => selection.kind === "detected"
      ? { detections: s.detections.map((d, i) =>
            i === selection.index ? { ...d, rating, rated: true, role: saved.pick.role } : d) }
      : { added: s.added.map((a, i) =>
            i === selection.index ? { ...a, rating, rated: true, role: saved.pick.role } : a) });
  },

  async addPick(lat, lon, category) {
    const { course } = get();
    if (!course) return;
    set(s => ({
      added: s.added.concat({
        lat, lon, category, role: "dr", source: "added",
        rating: null, rated: false, along_track_nm: 0, cross_track_nm: 0, area_m2: 0,
      }),
      selection: { kind: "added", index: s.added.length },
    }));
  },

  async removeSelected() {
    const { course, selection } = get();
    const point = currentPoint(get());
    if (!course || !selection || !point || selection.kind === "endpoint") return;
    await api.deletePick(course.departure.ident, course.destination.ident, point.lat, point.lon);
    // An added point existed only as a pick, so deleting it removes it. A
    // detection is still a detection, so it goes back to unrated.
    set(s => selection.kind === "added"
      ? { added: s.added.filter((_, i) => i !== selection.index), selection: null }
      : { detections: s.detections.map((d, i) =>
            i === selection.index ? { ...d, rating: null, rated: false } : d), selection: null });
  },
}));

export function currentPoint(state: LabelState): Point | null {
  const { selection, endpoints, detections, added } = state;
  if (!selection) return null;
  if (selection.kind === "endpoint") return endpoints[selection.index] ?? null;
  if (selection.kind === "detected") return detections[selection.index] ?? null;
  return added[selection.index] ?? null;
}
