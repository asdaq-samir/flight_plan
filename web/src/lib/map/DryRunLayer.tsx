import { useReplayMarker } from "./useReplayMarker";

/** The planned flight's dry run on the map: own ship flown along the
 *  course line as the replay plays, as if a pilot were flying the route
 *  (FPL's dry run; useReplayMarker's `asOwnShip`). The line is the
 *  course's own. */
export default function DryRunLayer() {
  useReplayMarker(true);
  return null;
}
