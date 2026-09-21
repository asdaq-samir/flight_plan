import { Button } from "../../../components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../../components/ui/alert";

interface Props {
  dep: string;
  dest: string;
  building: string | null;
  onBuild: () => void;
}

/** The one recoverable failure: the corridor exists but nobody has
 *  collected it yet, so there is nothing to score. shadcn's `Alert`,
 *  full width under the header, with the collect action in its own
 *  slot and the job's progress in the description while it runs. */
export default function BuildNotice({ dep, dest, building, onBuild }: Props) {
  return (
    <Alert className="rounded-none border-x-0 border-t-0 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
      <AlertTitle>{dep} → {dest} has not been collected yet.</AlertTitle>
      <AlertDescription>{building ?? "Collecting its candidate landmarks takes a few minutes."}</AlertDescription>
      <AlertAction>
        <Button size="sm" disabled={building !== null} onClick={onBuild}>Collect this route</Button>
      </AlertAction>
    </Alert>
  );
}
