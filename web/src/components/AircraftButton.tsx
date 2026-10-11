import { Plane } from "lucide-react";
import IconButton from "./IconButton";

/** Aircraft, under Nearest among the map's buttons on its left
 *  (MapControlsLeft), at the pilot's ask: the traffic about and a search
 *  for one airplane, to track it (AircraftCard). */
export default function AircraftButton({ onOpen }: { onOpen: () => void }) {
  return (
    <IconButton label="Track an aircraft" className="text-foreground" onClick={onOpen} data-testid="aircraft-button">
      <Plane strokeWidth={1.5} className="size-5" />
    </IconButton>
  );
}
