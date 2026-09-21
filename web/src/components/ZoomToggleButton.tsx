import type { ComponentProps } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import IconButton from "./IconButton";

interface Props extends Pick<ComponentProps<typeof IconButton>, "variant" | "className"> {
  /** Whether the map is on the selected point right now (so the button
   *  offers the whole route) or fitted to the route (so it offers the
   *  point). */
  zoomedIn: boolean;
  onClick: () => void;
  disabled: boolean;
  "data-testid"?: string;
}

/**
 * The map action Plan and Label share: fit the whole route, or zoom
 * in on the selected point. One component so the two pages cannot
 * drift apart in label, icon or placement (both draw it on the map,
 * see `MapControls`).
 */
export default function ZoomToggleButton({ zoomedIn, onClick, disabled, ...props }: Props) {
  return (
    <IconButton type="button" onClick={onClick} disabled={disabled} label={zoomedIn ? "Fit Route" : "Show Selected"} {...props}>
      {zoomedIn ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
    </IconButton>
  );
}
