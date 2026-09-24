import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_streamedQuery as streamedQuery, keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../../../lib/api/client";
import { courseQuery } from "../../../lib/queryClient";
import { routeOf } from "../../../lib/identSchema";
import { ended } from "../../../lib/api/streams";
import type { Course, Detection, Endpoint, LoosePick, Point, Rating, Role } from "../../../lib/api/types";
import { usePreferences } from "../../../lib/preferences";
import { pointKey, type PointKind } from "../logic";

/**
 * The training workspace's data: what the chart reader found for the
 * route (two queries -- the course, then the detections streamed a
 * block at a time -- kept for the session), and what the developer
 * has done to it here, kept apart as edits by each point's own place
 * and laid over the stream on every render. Every count on screen is
 * derived from those two, never tracked beside them: the page this
 * replaces kept a `judged` flag beside the rating it came from, a
 * summary the server sent beside counts computed locally, and a walk
 * numbered over a different set than the banner counted. Each of
 * those was one fact with two owners, and each drifted.
 *
 * The edits are the session's: a rating, a category, a removal, a
 * point added by hand, and the one step back. They belong to the
 * route they were made on -- a new route starts clean -- and the
 * server is written first, so a failed save changes nothing on
 * screen (the query client reports it).
 */

/** What a rating, a category change or a removal changes about a
 *  point: the fields the server's pick holds, kept by the point's own
 *  place. */
interface Edit {
  rating: Rating | null;
  rated: boolean;
  role: Role | null;
  category: string;
}

/** Enough to put a point back: its fields before the action, and for
 *  an added point that was removed, the point itself. */
interface UndoEntry {
  key: string;
  kind: "detected" | "added";
  before: Edit;
  reinsert?: LoosePick;
}

interface Edits {
  route: string;
  overrides: Record<string, Edit>;
  /** Points added by hand this session, never taken out of this list
   *  -- a removal marks them in `removed`, so an undo is one key. */
  added: LoosePick[];
  removed: string[];
  undo: UndoEntry | null;
  /** The selected point, by its place (`pointKey`) -- how everything
   *  else here already names a point: the overrides, the removals, the
   *  undo entry, and the server's own same_place. It used to be a
   *  position in the list of added points, and that list gets the picks
   *  no detection claimed put in front of it when the chart read ends:
   *  a point added mid-read then pointed at one of those, and the next
   *  digit key rated the wrong pick. */
  selection: string | null;
}

const editOf = (p: Detection | LoosePick): Edit => ({ rating: p.rating, rated: p.rated, role: p.role, category: p.category });
const fresh = (route: string): Edits => ({
  route, overrides: {}, added: [], removed: [], undo: null, selection: null,
});

export function useTraining(dep: string, dest: string) {
  const route = `${dep}-${dest}`;
  const routeKnown = routeOf(dep, dest) !== null;
  const filters = usePreferences(s => s.filters);
  const setFilter = usePreferences(s => s.setFilter);

  // The previous route's course stays on the map until the new one is
  // charted, so the map is never taken down between routes.
  const course = useQuery({ ...courseQuery(dep, dest), enabled: routeKnown, placeholderData: keepPreviousData });
  // The chart read, the slowest thing this page does: streamed a block
  // at a time from the departure end, and kept for the route.
  const stream = useQuery({
    queryKey: ["detections", dep, dest],
    queryFn: streamedQuery({ streamFn: ({ signal }) => ended(api.detect(dep, dest, signal), "chart read") }),
    // routeKnown as well as the course: a disabled course query still
    // hands back the previous route's course as placeholder data, and a
    // same-airport address then asked for that corridor's chart read.
    enabled: routeKnown && !!course.data, staleTime: Infinity,
  });
  const messages = useMemo(() => stream.data ?? [], [stream.data]);
  const streamed = useMemo(() => ({
    detections: messages.flatMap(m => (m.type === "block" ? m.detections : [])),
    // Picks no detection claimed arrive last: a later block might still
    // have claimed one, so they cannot be known any earlier.
    added: messages.flatMap(m => (m.type === "done" ? m.added : [])),
  }), [messages]);
  const lastBlock = messages.filter(m => m.type === "block").at(-1);
  const percent = lastBlock && lastBlock.type === "block" && lastBlock.blocks
    ? Math.round(((lastBlock.block + 1) / lastBlock.blocks) * 100) : 0;
  const progress = stream.isFetching ? `Reading the chart ${percent}%` : null;

  // The ends of the leg exist the moment the course does, so they are
  // on screen before a single tile has been read.
  const endpoints = useMemo<Endpoint[]>(() => {
    const c = course.data;
    if (!c) return [];
    return [
      { endpoint: true, ident: c.departure.ident, name: c.departure.name, lat: c.departure.lat, lon: c.departure.lon,
        along_track_nm: 0, category: "departure" },
      { endpoint: true, ident: c.destination.ident, name: c.destination.name, lat: c.destination.lat, lon: c.destination.lon,
        along_track_nm: c.distance_nm, category: "destination" },
    ];
  }, [course.data]);

  const [editsState, setEdits] = useState<Edits>(() => fresh(route));
  const edits = editsState.route === route ? editsState : fresh(route);
  const update = useCallback(
    (fn: (e: Edits) => Edits) => setEdits(e => fn(e.route === route ? e : fresh(route))),
    [route],
  );

  const overrides = edits.overrides;
  const apply = useCallback(<P extends Detection | LoosePick>(p: P): P => {
    const edit = overrides[pointKey(p)];
    return edit ? ({ ...p, ...edit } as P) : p;
  }, [overrides]);
  const detections = useMemo(() => streamed.detections.map(apply), [streamed.detections, apply]);
  const added = useMemo(
    () => [...streamed.added, ...edits.added].filter(p => !edits.removed.includes(pointKey(p))).map(apply),
    [streamed.added, edits.added, edits.removed, apply],
  );
  // Every point on screen by its place, and what kind it is: the ends,
  // then the detections, then the points added by hand. A detection
  // keeps its kind where an added point sits on the same place.
  const byKey = useMemo(() => {
    const map = new Map<string, { point: Point; kind: PointKind }>();
    for (const point of endpoints) map.set(pointKey(point), { point, kind: "endpoint" });
    for (const point of detections) map.set(pointKey(point), { point, kind: "detected" });
    for (const point of added) if (!map.has(pointKey(point))) map.set(pointKey(point), { point, kind: "added" });
    return map;
  }, [endpoints, detections, added]);
  // A removed point is no longer here, so it is no longer selected --
  // rather than the selection sliding on to its neighbour.
  const selected = edits.selection === null ? null : byKey.get(edits.selection)?.point ?? null;

  // What the actions below read: the current course, points and
  // selection, mirrored after every render so the actions themselves
  // keep one identity -- the map's popup and the key handler hang on
  // them, and a fresh function per render would rebuild both on every
  // streamed-in block.
  const current = { course: course.data ?? null, detections, added, byKey, edits, streamedAdded: streamed.added };
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });

  const { mutateAsync: savePick } = useMutation({
    mutationFn: (body: Parameters<typeof api.savePick>[0]) => api.savePick(body),
  });
  const { mutateAsync: deletePick } = useMutation({
    mutationFn: (p: { lat: number; lon: number }) => api.deletePick(dep, dest, p.lat, p.lon),
  });
  const pickBody = (c: Course, p: Detection | LoosePick, kind: "detected" | "added", fields: Partial<Edit>) => ({
    departure_ident: c.departure.ident, destination_ident: c.destination.ident,
    lat: p.lat, lon: p.lon, source: kind,
    category: fields.category ?? p.category, rating: fields.rating === undefined ? p.rating : fields.rating,
    area_m2: (p as Detection).area_m2 ?? null,
  });

  /** The selected point and its kind, when it is one that can be
   *  rated -- never an endpoint. */
  const selectedPick = () => {
    const { course: c, edits: e, byKey: points } = latest.current;
    const entry = e.selection === null ? undefined : points.get(e.selection);
    if (!c || !entry || entry.kind === "endpoint") return null;
    return { course: c, p: entry.point as Detection | LoosePick, kind: entry.kind };
  };

  const select = useCallback((point: Point | null) => {
    update(e => ({ ...e, selection: point ? pointKey(point) : null }));
  }, [update]);

  // A rating has to feel instant while walking the route, so every
  // call site fires these without waiting; a failed write is the
  // query client's to report, and changes nothing here.
  const rate = useCallback(async (rating: Rating) => {
    const target = selectedPick();
    if (!target) return;
    const before = editOf(target.p);
    const key = pointKey(target.p);
    try {
      const saved = await savePick(pickBody(target.course, target.p, target.kind, { rating }));
      update(e => ({
        ...e,
        overrides: { ...e.overrides, [key]: { ...before, rating, rated: true, role: saved.pick.role } },
        undo: { key, kind: target.kind, before },
      }));
    } catch {
      update(e => ({ ...e, undo: null }));   // nothing landed, so nothing to step back to
    }
  }, [savePick, update]);

  const setCategory = useCallback(async (category: string) => {
    const target = selectedPick();
    if (!target) return;
    const key = pointKey(target.p);
    try {
      const saved = await savePick(pickBody(target.course, target.p, target.kind, { category }));
      update(e => ({
        ...e, overrides: { ...e.overrides, [key]: { ...editOf(target.p), category, role: saved.pick.role } },
      }));
    } catch { /* reported by the query client */ }
  }, [savePick, update]);

  const removeSelected = useCallback(async () => {
    const target = selectedPick();
    if (!target) return;
    const before = editOf(target.p);
    const key = pointKey(target.p);
    try {
      await deletePick(target.p);
      // An added point existed only as a pick, so deleting it removes
      // it. A detection is still a detection, so it goes back to unrated.
      update(e => target.kind === "added"
        ? { ...e, removed: [...e.removed, key], selection: null,
            undo: { key, kind: "added", before, reinsert: target.p as LoosePick } }
        : { ...e, overrides: { ...e.overrides, [key]: { ...before, rating: null, rated: false } }, selection: null,
            undo: { key, kind: "detected", before } });
    } catch {
      update(e => ({ ...e, undo: null }));
    }
  }, [deletePick, update]);

  const undo = useCallback(async () => {
    const { course: c, edits: e, detections: d, added: a } = latest.current;
    const entry = e.undo;
    if (!entry || !c) return;
    update(x => ({ ...x, undo: null }));   // one-shot: this is the only step back there is
    try {
      if (entry.reinsert) {
        // It had a rating before it was deleted -- restore the pick,
        // then the point itself, at the place it had in the list.
        if (entry.before.rating !== null) await savePick(pickBody(c, entry.reinsert, "added", entry.before));
        update(x => ({ ...x, removed: x.removed.filter(k => k !== entry.key), selection: entry.key }));
        return;
      }
      const current = (entry.kind === "detected" ? d : a).find(p => pointKey(p) === entry.key);
      if (!current) return;
      // It was unrated before this action -- there's no pick to restore,
      // only one to take back off the server.
      if (entry.before.rating !== null) await savePick(pickBody(c, current, entry.kind, entry.before));
      else await deletePick(current);
      update(x => ({ ...x, overrides: { ...x.overrides, [entry.key]: entry.before } }));
    } catch { /* reported by the query client; a failed undo has nothing further back to step to */ }
  }, [savePick, deletePick, update]);

  const resetAll = useCallback(async () => {
    const { course: c, detections: d, added: a, streamedAdded } = latest.current;
    if (!c) return;
    const rated = [...d, ...a].filter(p => p.rating !== null);
    try {
      await Promise.all(rated.map(p => deletePick(p)));
      update(e => ({
        ...e,
        overrides: Object.fromEntries(rated.map(p => [pointKey(p), { ...editOf(p), rating: null, rated: false }])),
        removed: [...streamedAdded, ...e.added].map(pointKey),
        selection: null, undo: null,
      }));
    } catch {
      // Promise.all rejects on the first failure, but earlier deletes
      // in the same batch may already have landed server-side -- what
      // is on screen is left alone rather than guessed at.
    }
  }, [deletePick, update]);

  const addPick = useCallback(async (lat: number, lon: number) => {
    if (!latest.current.course) return;
    // What the chart draws at the point, so a click on the course gets a
    // real category rather than always landing on "other".
    const { category } = await api.classify(lat, lon).catch(() => ({ category: null }));
    const pick: LoosePick = {
      lat, lon, category: category ?? "other", role: "dr", source: "added",
      rating: null, rated: false, along_track_nm: 0, cross_track_nm: 0, area_m2: 0,
      route: null, note: null, created_at: null,
    };
    update(e => ({ ...e, added: [...e.added, pick], selection: pointKey(pick) }));
  }, [update]);

  return {
    course: course.data ?? null,
    endpoints, detections, added, filters, setFilter,
    selected, select,
    rate, setCategory, addPick, removeSelected, undo, resetAll,
    canUndo: edits.undo !== null,
    loading: course.isLoading || stream.isLoading || stream.isFetching,
    progress,
    /** The read itself failing -- the course, or the chart part-way --
     *  which the page shows in place of what it could not get. */
    error: errorMessage(course.error ?? stream.error, "could not read the chart"),
  };
}
