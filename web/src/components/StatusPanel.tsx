import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ListGroup, ListRow } from "./GroupedList";
import { api } from "../lib/api/client";
import type { MapLayerAges } from "../lib/api/types";
import { useMinuteClock, zuluTime } from "../lib/clock";
import { PROBLEM_ID } from "../lib/fromCache";
import { ageWords, useLayerAges } from "../lib/map/layerAges";
import { useSystemProblems } from "../lib/problems";
import { TEXT } from "../lib/text";

/**
 * The pilot's Status page, beside Guide and About, at the owner's ask
 * ("We should keep this info in a Status sheet next to About and Guide",
 * 2026-11-04): how old everything the plan rests on is, and what is kept
 * through a dropped connection. This phone's connection and whether the
 * page is showing answers the service worker kept (lib/fromCache); then
 * each source the planner downloads -- the METARs, TAFs, AIRMETs and
 * SIGMETs, G-AIRMETs, PIREPs, winds aloft and TFRs -- with when its copy
 * was fetched and, where the source is not answering, to when the copy
 * held is used by its product's own validity (vfr.weather); and the
 * traffic, as the map last heard it. Asked again each minute while open.
 */
export default function StatusPanel() {
  const now = useMinuteClock();
  const online = useOnline();
  const saved = useSystemProblems(s => s.problems.find(p => p.id === PROBLEM_ID));
  // The map's settings ask the same question (useLayerAges), one answer
  // for both.
  const { data, isError } = useQuery({
    queryKey: ["mapAges"], queryFn: () => api.mapAges(), refetchInterval: 60_000, staleTime: 30_000, meta: { silent: true },
  });
  const { traffic } = useLayerAges();
  return (
    <div className="space-y-5 pb-1" data-testid="status-panel">
      <ListGroup title="Connection">
        <ListRow
          title="This phone" value={online ? "Online" : "Offline"} data-testid="status-connection"
          description={saved ? <span className={TEXT.detail}>{saved.title}</span> : undefined}
        />
      </ListGroup>

      <ListGroup title="Weather and TFRs">
        {data?.sources?.length ? data.sources.map(s => (
          <ListRow
            key={s.name} title={s.name} data-testid="status-source"
            value={ageWords(s.fetched_at ? Date.parse(s.fetched_at) : null, now) ?? "Not yet"}
            description={s.failing ? <span className={cn("text-destructive-ink", TEXT.detail)}>{failingWords(s)}</span> : undefined}
          />
        )) : (
          <ListRow muted title={isError ? "The planner could not be reached" : "Checking…"} data-testid="status-sources-none" />
        )}
      </ListGroup>

      <ListGroup title="Traffic">
        <ListRow title="Airplanes nearby" value={traffic ?? "None heard"} data-testid="status-traffic" />
      </ListGroup>
    </div>
  );
}

/** What a source that is not answering leaves the plan with: the copy
 *  held, to when it is used, or nothing. */
function failingWords(s: MapLayerAges["sources"][number]): string {
  if (!s.fetched_at) return "Not answering, and none held";
  if (!s.kept_until) return "Not answering: the last copy is used";
  const until = new Date(s.kept_until);
  return until.getTime() > Date.now()
    ? `Not answering: the last copy is used until ${zuluTime(until)}`
    : "Not answering: the last copy has run out";
}

/** Whether the browser has a network, said again as it comes and goes. */
function useOnline(): boolean {
  return useSyncExternalStore(
    change => {
      window.addEventListener("online", change);
      window.addEventListener("offline", change);
      return () => {
        window.removeEventListener("online", change);
        window.removeEventListener("offline", change);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
