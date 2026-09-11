/**
 * The shapes the API actually returns. Written from the responses rather
 * than from the Python source, so a field that is documented but absent
 * cannot be typed into existence.
 *
 * These types are the reason for TypeScript here. The costliest bug in
 * this page's history was renaming `judged` to `rated` and missing a
 * call site -- silent at runtime, a compile error now.
 */

export type Role = "dr" | "visual";
export type Source = "detected" | "added";
export type Rating = 0 | 1 | 2 | 3 | 4 | 5;

/** A point the chart-vision detector found. */
export interface Detection {
  lat: number;
  lon: number;
  category: string;
  area_m2: number;
  score: number;
  along_track_nm: number;
  cross_track_nm: number;
  /** null until a pick claims it. The rating is the fact; `rated` is derived. */
  rating: Rating | null;
  role: Role | null;
  rated: boolean;
}

/** A pick no detection claimed: a miss, or one whose detection has moved. */
export interface LoosePick {
  lat: number;
  lon: number;
  category: string;
  role: Role;
  source: Source;
  rating: Rating | null;
  rated: boolean;
  along_track_nm: number;
  cross_track_nm: number;
  area_m2: number;
}

/** The ends of the leg. Steppable and described, but never rated. */
export interface Endpoint {
  endpoint: true;
  ident: string;
  name: string;
  lat: number;
  lon: number;
  along_track_nm: number;
  category: "departure" | "destination";
}

/** Anything the walk can land on. */
export type Point = Detection | LoosePick | Endpoint;

export function isEndpoint(p: Point): p is Endpoint {
  return (p as Endpoint).endpoint === true;
}

export interface Course {
  departure: { ident: string; name: string; lat: number; lon: number };
  destination: { ident: string; name: string; lat: number; lon: number };
  distance_nm: number;
  bearing_deg: number;
  course_line: [number, number][];
  tile_url: string;
  max_zoom: number;
  min_zoom: number;
}

export interface PickSummary {
  total: number;
  accepted: number;
  rejected: number;
  added: number;
  by_rating: Record<string, number>;
  by_role: Record<Role, number>;
}

/** One line of the detection stream. */
export type StreamMessage =
  | { type: "start"; route: string }
  | {
      type: "block";
      block: number;
      blocks: number;
      tiles: number;
      missing: number;
      detections: Detection[];
    }
  | { type: "done"; total: number; added: LoosePick[]; summary: PickSummary };
