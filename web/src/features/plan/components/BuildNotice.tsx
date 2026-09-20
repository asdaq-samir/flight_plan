import { Button } from "../../../components/ui/button";

interface Props {
  dep: string;
  dest: string;
  building: string | null;
  onBuild: () => void;
}

/** The one recoverable failure: the corridor exists but nobody has
 *  collected it yet, and the page can start that job itself. */
export default function BuildNotice({ dep, dest, building, onBuild }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
      <span>{dep} → {dest} has not been collected yet. This takes a few minutes.</span>
      <Button disabled={building !== null} onClick={onBuild}>Collect this route</Button>
      <span className="text-muted-foreground">{building}</span>
    </div>
  );
}
