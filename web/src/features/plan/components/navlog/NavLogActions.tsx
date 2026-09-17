import { Button } from "../../../../components/ui/button";

interface Props {
  onMapClick: () => void;
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M9 18l-5-2V4l5 2 6-2 5 2v14l-5-2-6 2-6-2Z" />
      <path d="M9 6v12M15 4v12" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="8" rx="1" />
      <path d="M6 17v4h12v-4" />
    </svg>
  );
}

/**
 * The nav log's own top-right pair -- back to the map, or print this.
 * Icon-only, not the text pill `MapActionButton` uses elsewhere: two
 * side by side read more like a toolbar than two competing actions
 * once they both say something in words. `print:hidden` on both
 * (see `NavLogView`'s own print overrides) -- neither belongs in the
 * printed page itself.
 */
const buttonClass = "size-10 rounded-lg border-2 border-white shadow-[0_2px_10px_rgba(0,0,0,.5)] print:hidden";

export default function NavLogActions({ onMapClick }: Props) {
  return (
    <div className="absolute right-3 top-3 z-[1000] flex gap-2 print:hidden">
      <Button
        onClick={onMapClick} title="Back to map" aria-label="Back to map"
        data-testid="map-action-button" className={buttonClass}
      >
        <MapIcon />
      </Button>
      <Button
        onClick={() => window.print()} title="Print" aria-label="Print"
        data-testid="print-button" className={buttonClass}
      >
        <PrintIcon />
      </Button>
    </div>
  );
}
