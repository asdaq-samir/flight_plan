import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api/client";
import { statusQuery } from "../../lib/queryClient";
import { useConfirm } from "../../components/useConfirm";
import { useConsoleOpen } from "../../components/mapChrome";
import { usePreferences } from "../../lib/preferences";

/**
 * The one action that changes the model, and what a button for it
 * needs to know: whether Airflow is reachable, whether a run is
 * already going, and how the last one ended. Shared by the side
 * drawer's own Retrain (in its More menu, with Reset, in the drawer
 * where the ratings it learns from are made) and the developer console's
 * Performance tab, which reports the run on each route's card and
 * offers it there too. The status snapshot is the same query both
 * poll, so a run started from either shows in both.
 */
export function useRetrain() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery(statusQuery);
  const start = useMutation({
    mutationFn: api.retrain,
    onSuccess: run => {
      toast.success("Retrain started", {
        description: run.dag_run_id ? `Airflow run ${run.dag_run_id}; the Performance tab follows it.` : undefined,
      });
      // Returned, so the mutation stays pending until the snapshot shows
      // the run: Retrain was enabled again in between, for a second press.
      return queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
  const pipeline = status?.pipeline;
  const lastRun = pipeline?.last_run ?? null;
  const running = lastRun?.state === "running" || lastRun?.state === "queued";
  // Whether the ratings are enough to learn from, worked out by the
  // planner before any run (vfr.pipeline.training_readiness): too few,
  // and the button says why instead of starting a run that fails in
  // Airflow. Unknown (no corridor read yet) leaves it to the run.
  const training = pipeline?.training ?? null;
  const blocked = training && !training.ready ? training.message : null;
  // Asks first, wherever the button is: a retrain is minutes of
  // Airflow's time and, when it ends, a new model serving in place of
  // this one -- not something a stray tap should start.
  const [ask, confirmDialog] = useConfirm({
    title: "Retrain the model?",
    description: "It learns from every rating. When it finishes, the new model replaces the one serving. It takes a few minutes.",
    confirmLabel: "Retrain",
    // The run is followed on the console's Performance tab: opened on
    // it, from wherever the retrain was asked for -- the side panel's
    // More menu, or the tab itself.
    onConfirm: () => {
      usePreferences.getState().setDevTab("performance");
      useConsoleOpen.getState().setOpen(true);
      start.mutate();
    },
  });
  return {
    status,
    pipeline,
    lastRun,
    reachable: pipeline?.airflow_reachable ?? false,
    running,
    starting: start.isPending,
    /** The ratings against what training needs, and what became of the rest. */
    training,
    /** Why a retrain would have too little to learn from, or null. */
    blocked,
    /** Whether the button should be enabled: enough ratings, Airflow reachable, no run in progress, none just asked for. */
    canStart: (pipeline?.airflow_reachable ?? false) && !running && !start.isPending && !blocked,
    /** Opens the confirmation; the retrain starts from its button. */
    start: ask,
    /** The confirmation itself, rendered by whichever panel has the button. */
    confirmDialog,
  };
}
