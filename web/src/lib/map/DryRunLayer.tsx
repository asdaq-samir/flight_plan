import { useReplayMarker } from "./useReplayMarker";

/** The planned flight's dry run on the map: its airplane flown along the
 *  course line as the replay plays (FPL's dry run, useDryRun). The line is
 *  the course's own. */
export default function DryRunLayer() {
  useReplayMarker();
  return null;
}
