import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import type { Course, Detection, Endpoint, LoosePick, Point, Rating, Role } from "../../../lib/api/types";
import { DEFAULT_FILTERS, FILTER_KEYS, type FilterKey, type Filters } from "../logic";

interface CachedDetections {
  detections: Detection[];
  added: LoosePick[];
}

/**
 * All the labeling view's state, in one place.
 *
 * The point of gathering it here is not tidiness -- it is that every
 * count on screen is *derived* from this rather than tracked alongside
 * it. The page this replaces kept a `judged` flag beside the rating it
 * came from, a summary the server sent beside counts computed locally,
 * and a walk numbered over a different set than the banner counted.
 * Each of those was one fact with two owners, and each drifted.
 *
 * This used to be a zustand store (`create<LabelState>(...)`). Rolled
 * back to a plain hook -- see "Learning this from zero" in
 * web/README.md for when a dependency like that is worth bringing
 * back.
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
  /** Whether `undo` has anything to do -- state, not just a ref, since
   *  the button showing it needs to re-render the moment this changes. */
  canUndo: boolean;
}

/**
 * Enough of the point's pre-action shape to put it back: `rate` and
 * `removeSelected` are the only actions worth a one-step undo (a
 * mis-tap on either is the "oops" this covers; a category correction
 * or a fresh add rarely is). `reinsert` is set only for undoing the
 * delete side of `removeSelected` on an "added" point -- everything
 * else is a field revert on a point still in place.
 */
interface UndoEntry {
  kind: "detected" | "added";
  index: number;
  rating: Rating | null;
  rated: boolean;
  role: Detection["role"];
  category: string;
  reinsert?: LoosePick;
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

function initialState(): LabelState {
  return {
    course: null, endpoints: [], detections: [], added: [],
    filters: savedFilters(), selection: null, lastFocus: null,
    loading: false, progress: null, error: null, canUndo: false,
  };
}

export function useLabelState() {
  const [state, setState] = useState<LabelState>(initialState);
  // A get()-like mirror for the async methods below, updated every
  // render: `rate` and `removeSelected` need the *current* course and
  // selection, not whatever was current when the callback was created.
  const ref = useRef(state);
  ref.current = state;
  const lastUndo = useRef<UndoEntry | null>(null);
  const queryClient = useQueryClient();

  const load = useCallback(async (dep: string, dest: string) => {
    lastUndo.current = null;
    setState(s => ({
      ...s, loading: true, error: null, detections: [], added: [], selection: null, canUndo: false,
    }));
    let course: Course;
    try {
      // Same query key Plan's own usePlanState uses for the identical
      // endpoint, and the same staleTime: Infinity reasoning -- a
      // charted course doesn't change out from under a fixed dep/dest,
      // so navigating here from Plan (or back to this page later in
      // the session) for a route already charted skips the round trip
      // entirely, on either page.
      course = await queryClient.fetchQuery({
        queryKey: ["course", dep, dest], queryFn: () => api.course(dep, dest), staleTime: Infinity,
      });
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: (err as Error).message }));
      return;
    }
    // The ends of the leg exist the moment the course does, so they are
    // on screen before a single tile has been read.
    setState(s => ({
      ...s,
      course,
      endpoints: [
        { endpoint: true, ident: course.departure.ident, name: course.departure.name,
          lat: course.departure.lat, lon: course.departure.lon,
          along_track_nm: 0, category: "departure" },
        { endpoint: true, ident: course.destination.ident, name: course.destination.name,
          lat: course.destination.lat, lon: course.destination.lon,
          along_track_nm: course.distance_nm, category: "destination" },
      ],
    }));

    // The chart-reading detector itself has no query-cacheable shape
    // (a stream, not a single request/response) -- this is a manual
    // version of the same idea `fetchQuery` gives course/checkpoints
    // above: check the cache first, and only actually re-read the
    // chart (genuinely the slowest thing this page does) when nothing
    // is there for this exact dep/dest yet.
    const cached = queryClient.getQueryData<CachedDetections>(["detections", dep, dest]);
    if (cached) {
      setState(s => ({ ...s, detections: cached.detections, added: cached.added, loading: false }));
      return;
    }

    let allDetections: Detection[] = [];
    try {
      for await (const msg of api.detect(dep, dest)) {
        if (msg.type === "block") {
          allDetections = allDetections.concat(msg.detections);
          const pct = msg.blocks ? Math.round(((msg.block + 1) / msg.blocks) * 100) : 0;
          setState(s => ({ ...s, detections: allDetections, progress: `Reading the chart ${pct}%` }));
        } else if (msg.type === "done") {
          // Picks no detection claimed arrive last: a later block might
          // still have claimed one, so it cannot be known any earlier.
          setState(s => ({ ...s, added: msg.added, progress: null, loading: false }));
          queryClient.setQueryData<CachedDetections>(
            ["detections", dep, dest], { detections: allDetections, added: msg.added },
          );
        }
      }
    } catch (err) {
      setState(s => ({ ...s, loading: false, progress: null, error: (err as Error).message }));
    }
  }, [queryClient]);

  const setFilter = useCallback((key: FilterKey, on: boolean) => {
    const filters = { ...ref.current.filters, [key]: on };
    setState(s => ({ ...s, filters }));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch { /* refused */ }
  }, []);

  const select = useCallback((selection: Selection | null) => {
    setState(s => ({ ...s, selection, lastFocus: selection ?? s.lastFocus }));
  }, []);

  const rate = useCallback(async (rating: Rating) => {
    const { course, selection } = ref.current;
    if (!course || !selection || selection.kind === "endpoint") return;
    const point = currentPoint(ref.current);
    if (!point) return;

    // Captured before the write, so undo has the exact shape to put
    // back rather than a guess at it.
    const before = point as Detection | LoosePick;
    lastUndo.current = {
      kind: selection.kind, index: selection.index,
      rating: before.rating, rated: before.rated, role: before.role, category: before.category,
    };

    // void store.rate(...) at every call site (a rating has to feel
    // instant while walking the route, not wait on a round trip) means
    // nothing else ever sees this reject -- without its own try/catch,
    // a failed save was previously silent: the row would just... not
    // update, with nothing on screen saying why.
    try {
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
      setState(s => selection.kind === "detected"
        ? { ...s, error: null, detections: s.detections.map((d, i) =>
              i === selection.index ? { ...d, rating, rated: true, role: saved.pick.role } : d), canUndo: true }
        : { ...s, error: null, added: s.added.map((a, i) =>
              i === selection.index ? { ...a, rating, rated: true, role: saved.pick.role } : a), canUndo: true });
    } catch (err) {
      // The write never landed, so the row's own state is still
      // accurate -- nothing to walk back to, unlike a real undo step.
      lastUndo.current = null;
      setState(s => ({ ...s, error: `Couldn't save that rating: ${(err as Error).message}` }));
    }
  }, []);

  const addPick = useCallback(async (lat: number, lon: number) => {
    if (!ref.current.course) return;
    // What the chart draws at the point, so a click on the course gets a
    // real category rather than always landing on "other".
    const { category } = await api.classify(lat, lon).catch(() => ({ category: null }));
    setState(s => ({
      ...s,
      added: s.added.concat({
        lat, lon, category: category ?? "other", role: "dr", source: "added",
        rating: null, rated: false, along_track_nm: 0, cross_track_nm: 0, area_m2: 0,
      }),
      selection: { kind: "added", index: s.added.length },
    }));
  }, []);

  const setCategory = useCallback(async (category: string) => {
    const { course, selection } = ref.current;
    if (!course || !selection || selection.kind === "endpoint") return;
    const point = currentPoint(ref.current);
    if (!point) return;
    const rating = (point as { rating: Rating | null }).rating;

    try {
      const saved = await api.savePick({
        departure_ident: course.departure.ident,
        destination_ident: course.destination.ident,
        lat: point.lat, lon: point.lon,
        source: selection.kind === "added" ? "added" : "detected",
        category, rating,
        area_m2: (point as Detection).area_m2 ?? null,
      });

      setState(s => selection.kind === "detected"
        ? { ...s, error: null, detections: s.detections.map((d, i) =>
              i === selection.index ? { ...d, category, role: saved.pick.role } : d) }
        : { ...s, error: null, added: s.added.map((a, i) =>
              i === selection.index ? { ...a, category, role: saved.pick.role } : a) });
    } catch (err) {
      setState(s => ({ ...s, error: `Couldn't save that category: ${(err as Error).message}` }));
    }
  }, []);

  const removeSelected = useCallback(async () => {
    const { course, selection } = ref.current;
    const point = currentPoint(ref.current);
    if (!course || !selection || !point || selection.kind === "endpoint") return;

    const before = point as Detection | LoosePick;
    lastUndo.current = selection.kind === "added"
      // The point is about to leave the array entirely -- undo needs
      // the whole thing back, not just its fields, to re-insert it.
      ? { kind: "added", index: selection.index, rating: before.rating, rated: before.rated,
          role: before.role, category: before.category, reinsert: before as LoosePick }
      : { kind: "detected", index: selection.index, rating: before.rating, rated: before.rated,
          role: before.role, category: before.category };

    try {
      await api.deletePick(course.departure.ident, course.destination.ident, point.lat, point.lon);
      // An added point existed only as a pick, so deleting it removes it. A
      // detection is still a detection, so it goes back to unrated.
      setState(s => selection.kind === "added"
        ? { ...s, error: null, added: s.added.filter((_, i) => i !== selection.index), selection: null, canUndo: true }
        : { ...s, error: null, detections: s.detections.map((d, i) =>
              i === selection.index ? { ...d, rating: null, rated: false } : d),
            selection: null, canUndo: true });
    } catch (err) {
      lastUndo.current = null;
      setState(s => ({ ...s, error: `Couldn't remove that point: ${(err as Error).message}` }));
    }
  }, []);

  const undo = useCallback(async () => {
    const entry = lastUndo.current;
    const { course } = ref.current;
    if (!entry || !course) return;
    lastUndo.current = null;   // one-shot: this is the only step back there is

    try {
      if (entry.reinsert) {
        // It had a rating before it was deleted -- restore the persisted
        // pick, then put the point itself back at its original index.
        if (entry.rating !== null) {
          await api.savePick({
            departure_ident: course.departure.ident, destination_ident: course.destination.ident,
            lat: entry.reinsert.lat, lon: entry.reinsert.lon, source: "added",
            category: entry.category, rating: entry.rating, area_m2: entry.reinsert.area_m2 ?? null,
          });
        }
        const restored = entry.reinsert;
        setState(s => ({
          ...s, error: null,
          added: [...s.added.slice(0, entry.index), restored, ...s.added.slice(entry.index)],
          selection: { kind: "added", index: entry.index }, canUndo: false,
        }));
        return;
      }

      const point = entry.kind === "detected"
        ? ref.current.detections[entry.index] : ref.current.added[entry.index];
      if (!point) return;

      if (entry.rating !== null) {
        await api.savePick({
          departure_ident: course.departure.ident, destination_ident: course.destination.ident,
          lat: point.lat, lon: point.lon,
          source: entry.kind === "added" ? "added" : "detected",
          category: entry.category, rating: entry.rating, area_m2: (point as Detection).area_m2 ?? null,
        });
      } else {
        // It was unrated before this action -- there's no pick to restore,
        // only one to take back off the server.
        await api.deletePick(course.departure.ident, course.destination.ident, point.lat, point.lon);
      }

      setState(s => entry.kind === "detected"
        ? { ...s, error: null, detections: s.detections.map((d, i) => i === entry.index
              ? { ...d, rating: entry.rating, rated: entry.rated, role: entry.role, category: entry.category }
              : d), canUndo: false }
        // entry.role is typed Role | null (Detection allows a null role) even
        // though this branch only ever runs for an "added" point, whose role
        // is never null -- addPick always sets one, and LoosePick's own type
        // requires it.
        : { ...s, error: null, added: s.added.map((a, i) => i === entry.index
              ? { ...a, rating: entry.rating, rated: entry.rated, role: entry.role as Role, category: entry.category }
              : a), canUndo: false });
    } catch (err) {
      // lastUndo is already cleared above (one-shot) -- a failed undo
      // has nothing further back to step to, same as a failed rate.
      setState(s => ({ ...s, error: `Couldn't undo that: ${(err as Error).message}` }));
    }
  }, []);

  const resetAll = useCallback(async () => {
    const { course, detections, added } = ref.current;
    if (!course) return;
    lastUndo.current = null;   // a bulk reset isn't itself one undo step

    const rated = [
      ...detections.filter(d => d.rating !== null),
      ...added.filter(a => a.rating !== null),
    ];
    try {
      await Promise.all(rated.map(p =>
        api.deletePick(course.departure.ident, course.destination.ident, p.lat, p.lon)));

      setState(s => ({
        ...s, error: null,
        detections: s.detections.map(d => d.rating === null ? d : { ...d, rating: null, rated: false }),
        added: [],
        selection: null, canUndo: false,
      }));
    } catch (err) {
      // Promise.all rejects on the first failure, but earlier deletes in
      // the same batch may already have landed server-side -- local
      // state (only touched once every delete has resolved) is left
      // alone rather than guessed at, so this can undercount what
      // actually got cleared. Good enough to surface the failure at
      // all; reconciling against the server's own state is its own,
      // separate piece of work.
      setState(s => ({ ...s, error: `Couldn't reset every rating: ${(err as Error).message}` }));
    }
  }, []);

  return { ...state, load, setFilter, select, rate, setCategory, addPick, removeSelected, undo, resetAll };
}

export function currentPoint(
  state: Pick<LabelState, "selection" | "endpoints" | "detections" | "added">,
): Point | null {
  const { selection, endpoints, detections, added } = state;
  if (!selection) return null;
  if (selection.kind === "endpoint") return endpoints[selection.index] ?? null;
  if (selection.kind === "detected") return detections[selection.index] ?? null;
  return added[selection.index] ?? null;
}
