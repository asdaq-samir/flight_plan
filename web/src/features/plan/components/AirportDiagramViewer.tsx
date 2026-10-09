import L from "leaflet";
import { useEffect, useMemo } from "react";
import { ImageOverlay, MapContainer, useMap } from "react-leaflet";
import CloseButton from "../../../components/CloseButton";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../../../components/ui/dialog";
import { TEXT } from "../../../lib/text";
import { cn } from "cn";

/** No further out than the whole sheet in sight (FitWhole), and in to
 *  two of its pixels a point: past that the picture, drawn at 360 dots an
 *  inch (vfr.publications), only grows coarser. */
const MAX_ZOOM = 1;

/** The whole sheet as the furthest out, however the screen is turned. */
function FitWhole({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      const whole = map.getBoundsZoom(bounds);
      map.setMinZoom(whole);
      if (map.getZoom() < whole) map.fitBounds(bounds);
    };
    fit();
    map.on("resize", fit);
    return () => {
      map.off("resize", fit);
    };
  }, [map, bounds]);
  return null;
}

/**
 * An airport diagram full screen, to pinch in on as the chart is: the
 * picture on a Leaflet map of its own pixels (CRS.Simple), so a pinch, a
 * drag and a double tap do what they do on the chart, and the sheet stays
 * on the screen. A modal dialog, the map behind it waiting; the close in
 * the corner every panel has it in, and the FAA's PDF a tap away, for a
 * print or another app.
 */
export default function AirportDiagramViewer({ ident, cycle, src, size, pdf, onClose }: {
  ident: string;
  cycle: string;
  src: string;
  size: { width: number; height: number };
  pdf: string | null;
  onClose: () => void;
}) {
  const bounds = useMemo(() => L.latLngBounds([0, 0], [size.height, size.width]), [size]);
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined} data-testid="airport-diagram-viewer" showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        {/* Under the status bar, the close where every panel has it. */}
        <div className="flex shrink-0 items-center gap-4 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))]">
          <DialogTitle className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.title)}>{ident} airport diagram, d-TPP {cycle}</DialogTitle>
          {pdf && (
            <a href={pdf} target="_blank" rel="noreferrer" className={cn("relative shrink-0 text-tint after:absolute after:-inset-3", TEXT.row)} data-testid="airport-diagram-pdf">
              FAA PDF
            </a>
          )}
          <DialogClose asChild>
            <CloseButton data-testid="airport-diagram-close" />
          </DialogClose>
        </div>
        <MapContainer
          crs={L.CRS.Simple} bounds={bounds} maxBounds={bounds} maxBoundsViscosity={1}
          zoomSnap={0} minZoom={-5} maxZoom={MAX_ZOOM}
          attributionControl={false} zoomControl={false}
          // The diagram's paper round it, black at night where it is drawn
          // white on black.
          className="min-h-0 flex-1 bg-white! dark:bg-black! dark:[&_.leaflet-image-layer]:invert"
        >
          <ImageOverlay url={src} bounds={bounds} />
          <FitWhole bounds={bounds} />
        </MapContainer>
      </DialogContent>
    </Dialog>
  );
}
