import CloseButton from "../../../components/CloseButton";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../../../components/ui/dialog";
import type { Runway } from "../../../lib/api/types";
import { TEXT, TEXT_POINTS } from "../../../lib/text";
import { cn } from "cn";
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
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined} data-testid="airport-sketch-viewer" showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-4 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))]">
          <DialogTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title)}>{ident} runways</DialogTitle>
          <DialogClose asChild>
            <CloseButton data-testid="airport-sketch-close" />
          </DialogClose>
        </div>
        <div className="relative min-h-0 flex-1 text-foreground">
          <RunwaySketch runways={runways} lat={lat} lon={lon} numberSize={TEXT_POINTS.row} />
        </div>
        <p className={cn("shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-muted-foreground", TEXT.note)}>
          Sketched from the runways' surveyed ends, north up and to scale. Not an FAA airport diagram: the FAA publishes none for this field.
        </p>
      </DialogContent>
    </Dialog>
  );
}
