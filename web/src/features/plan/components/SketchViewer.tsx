import type { Runway } from "../../../lib/api/types";
import { TEXT, TEXT_POINTS } from "../../../lib/text";
import { cn } from "cn";
import FullScreenViewer from "./FullScreenViewer";
import { RunwaySketch } from "./RunwaySketch";

/**
 * A field's runways full screen, the card's own sketch of them
 * (RunwaySketch), for a field the FAA draws no airport diagram for: its
 * Diagrams tab's Airport diagram row opens it, at the pilot's ask, as it
 * opens the FAA's where there is one -- the same full screen as the FAA's
 * charts (ChartViewer), its title and close where they are, and a line
 * saying what it is drawn from.
 */
export default function SketchViewer({ ident, runways, lat, lon, onClose }: {
  ident: string;
  runways: Runway[];
  lat: number;
  lon: number;
  onClose: () => void;
}) {
  return (
    <FullScreenViewer title={`${ident} runways`} testId="airport-sketch-viewer" closeTestId="airport-sketch-close" onClose={onClose}>
      <div className="relative min-h-0 flex-1 text-foreground">
        <RunwaySketch runways={runways} lat={lat} lon={lon} numberSize={TEXT_POINTS.row} />
      </div>
      <p className={cn("shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-muted-foreground", TEXT.note)}>
        Sketched from the runways' surveyed ends, north up and to scale. Not an FAA airport diagram: the FAA publishes none for this field.
      </p>
    </FullScreenViewer>
  );
}
