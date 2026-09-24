import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, describeError } from "../../../lib/api/client";
import { elapsed } from "../format";

/** A job id the planner answers 404 for: it restarted, and forgot. */
const vanished = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Where collecting the route on screen stands -- one value, where the
 *  page used to fold starting, running, failed and a failed start into
 *  one nullable string that was both the message and the busy flag. */
export type Build =
  | { phase: "idle" }
  | { phase: "needed" }
  | { phase: "starting" }
  | { phase: "queued"; detail: string }
  | { phase: "running"; progress: string }
  | { phase: "failed"; detail: string };

/**
 * Collecting a corridor nobody has collected: minutes of Overpass, the
 * FAA subscription and an elevation lookup per candidate, so the planner
 * queues a job to poll rather than holding the request open. The job
 * remembers its own route: its progress, its failure and its "done"
 * belong to that route, not whichever one is on screen when they arrive.
 * `needed` is whether the route on screen is one nobody has collected
 * (its checkpoints said so, in usePlan).
 */
export function useCorridorBuild(dep: string, dest: string, needed: boolean) {
  const queryClient = useQueryClient();
  const [job, setJob] = useState<{ dep: string; dest: string; id: string; started: number } | null>(null);
  const startBuild = useMutation({
    mutationFn: (route: { dep: string; dest: string }) => api.startBuild(route.dep, route.dest),
    // The notice shows a failed start in place, with Collect to retry.
    meta: { silent: true },
    onSuccess: (started, route) => {
      if (started.state === "done" || !started.job_id) {
        void queryClient.invalidateQueries({ queryKey: ["checkpoints", route.dep, route.dest] });
      } else {
        setJob({ ...route, id: started.job_id, started: Date.now() });
      }
    },
  });
  const buildStatus = useQuery({
    queryKey: ["build", job?.id ?? null], queryFn: () => api.buildStatus(job!.id),
    enabled: !!job,
    refetchInterval: query => {
      // A job the planner no longer knows (it restarted) is not coming
      // back; any other failed poll is a blip, and polling goes on.
      if (vanished(query.state.error)) return false;
      const state = query.state.data?.state;
      return state === "done" || state === "failed" ? false : 2000;
    },
    meta: { silent: true },
  });
  useEffect(() => {
    if (!job || buildStatus.data?.state !== "done") return;
    // The job's own route's checkpoints asked for again, then the job
    // let go of -- in that order, so the notice stays up until the plan
    // has something.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["routes"] }),
      queryClient.invalidateQueries({ queryKey: ["checkpoints", job.dep, job.dest] }),
    ]).then(() => setJob(current => (current?.id === job.id ? null : current)));
  }, [buildStatus.data?.state, job, queryClient]);

  const build = ((): Build => {
    const jobHere = job && job.dep === dep && job.dest === dest ? job : null;
    const startedHere = startBuild.variables?.dep === dep && startBuild.variables?.dest === dest;
    if (!needed && !jobHere) return { phase: "idle" };
    if (startBuild.isPending && startedHere) return { phase: "starting" };
    if (jobHere) {
      if (vanished(buildStatus.error)) {
        return { phase: "failed", detail: "the planner restarted before the collection finished" };
      }
      const status = buildStatus.data;
      if (!status) return { phase: "starting" };
      if (status.state === "failed") return { phase: "failed", detail: status.detail ?? "the collection failed" };
      if (status.state === "queued") return { phase: "queued", detail: status.step ?? "waiting for the builds ahead of it" };
      // The elapsed time as of the last poll (the query's own timestamp),
      // not the clock read during render.
      return { phase: "running", progress: `${status.step} — ${elapsed(buildStatus.dataUpdatedAt - jobHere.started)} elapsed` };
    }
    // A full queue is a 429 saying to come back: a failure to retry,
    // not a lock on the button until the page is reloaded.
    if (startBuild.isError && startedHere) return { phase: "failed", detail: describeError(startBuild.error, "could not start the collection") };
    return { phase: "needed" };
  })();

  return { build, collect: () => startBuild.mutate({ dep, dest }) };
}
