import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api/client";

/**
 * The one action that changes the model, and what a button for it
 * needs to know: whether Airflow is reachable, whether a run is
 * already going, and how the last one ended. Shared by the side
 * drawer's own Retrain button (beside Undo and Reset, where the
 * ratings it learns from are made) and the Developer drawer's Model
 * Training tab, which reports the run. The status snapshot is the same
 * query both poll, so a run started from either shows in both.
 */
export function useRetrain() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["status"], queryFn: api.status, refetchInterval: 30000, retry: false,
  });
  const start = useMutation({
    mutationFn: api.retrain,
    onSuccess: run => {
      toast.success("Retrain started", {
        description: run.dag_run_id ? `Airflow run ${run.dag_run_id}; the Developer drawer follows it.` : undefined,
      });
      // Returned, so the mutation stays pending until the snapshot shows
      // the run: Retrain was enabled again in between, for a second press.
      return queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
  const pipeline = status?.pipeline;
  const lastRun = pipeline?.last_run ?? null;
  const running = lastRun?.state === "running" || lastRun?.state === "queued";
  return {
    status,
    pipeline,
    lastRun,
    reachable: pipeline?.airflow_reachable ?? false,
    running,
    starting: start.isPending,
    /** Whether the button should be enabled: Airflow reachable, no run in progress, none just asked for. */
    canStart: (pipeline?.airflow_reachable ?? false) && !running && !start.isPending,
    start: () => start.mutate(),
  };
}
