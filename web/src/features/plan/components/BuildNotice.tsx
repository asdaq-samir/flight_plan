import { Button } from "../../../components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import type { Build } from "../hooks/useCorridorBuild";

interface Props {
  dep: string;
  dest: string;
  build: Exclude<Build, { phase: "idle" }>;
  onBuild: () => void;
}

/** What the notice says under its title, phase by phase. */
function describe(build: Props["build"]): string {
  switch (build.phase) {
    case "needed": return "Collecting its candidate landmarks takes a few minutes.";
    case "starting": return "starting…";
    case "queued": return `Queued: ${build.detail}.`;
    case "running": return build.progress;
    case "failed": return `The collection failed (${build.detail}). Collect again to retry.`;
  }
}

/** The one recoverable failure: the corridor exists but nobody has
 *  collected it yet, so there is nothing to score. shadcn's `Alert`,
 *  full width under the header, with the collect action in its own
 *  slot and the job's progress in the description while it runs. The
 *  button waits only while a collection is under way; after a failure
 *  it is the retry. */
export default function BuildNotice({ dep, dest, build, onBuild }: Props) {
  const busy = build.phase === "starting" || build.phase === "queued" || build.phase === "running";
  return (
    <Alert className="rounded-none border-x-0 border-t-0 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
      <AlertTitle>{dep} → {dest} has not been collected yet.</AlertTitle>
      <AlertDescription>{describe(build)}</AlertDescription>
      <AlertAction>
        <Button size="sm" disabled={busy} onClick={onBuild}>Collect this route</Button>
      </AlertAction>
    </Alert>
  );
}
