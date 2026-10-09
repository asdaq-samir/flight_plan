import { Radar } from "lucide-react";
import IconButton from "./IconButton";

/** Nearest, among the map's buttons on its left (MapControlsLeft): the
 *  fields nearest the pilot's position, a card of the panel's
 *  (NearestCard), with or without a route. A radar's sweep for its glyph,
 *  the landing airplane it wore being the route's Approaches now. */
export default function NearestButton({ onOpen }: { onOpen: () => void }) {
  return (
    <IconButton label="Nearest airports" className="text-foreground" onClick={onOpen} data-testid="nearest-button">
      <Radar strokeWidth={1.5} className="size-5" />
    </IconButton>
  );
}
