import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Traffic } from "../api/types";
import { useMinuteClock } from "../clock";

/** How long ago `at` (ms) was, in a few words: "just now" under a
 *  minute, "4 min ago", "2 h 5 min ago"; null for no time. */
export function ageWords(at: number | null, now: number): string | null {
  if (at == null || Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
}

/** The newest traffic answer the map holds: when its airplanes were
 *  where it gives them (its time, less its own `age_s`). */
export function trafficAt(answers: { data: Traffic | undefined; updatedAt: number }[]): number | null {
  const newest = answers.filter(a => a.data && a.updatedAt > 0).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return newest ? newest.updatedAt - (newest.data!.age_s ?? 0) * 1000 : null;
}

/**
 * When the data under each of the map's weather layers is from, for the
 * map's settings: the METARs its airports' flight categories come from
 * and the TFRs, as the planner fetched them (/api/map/ages), and the
 * traffic, as the map last heard it. Asked again each minute while the
 * settings are open, and said again each minute.
 */
export function useLayerAges(): { metars: string | null; tfrs: string | null; traffic: string | null } {
  const now = useMinuteClock();
  const { data } = useQuery({ queryKey: ["mapAges"], queryFn: () => api.mapAges(), refetchInterval: 60_000, staleTime: 30_000, meta: { silent: true } });
  const client = useQueryClient();
  const traffic = trafficAt(client.getQueryCache().findAll({ queryKey: ["traffic"] })
    .map(q => ({ data: q.state.data as Traffic | undefined, updatedAt: q.state.dataUpdatedAt })));
  const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
  return { metars: ageWords(ms(data?.metars_at), now), tfrs: ageWords(ms(data?.tfrs_at), now), traffic: ageWords(traffic, now) };
}
