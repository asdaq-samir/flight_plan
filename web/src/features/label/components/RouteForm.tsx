import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
  /** The page's own single most-needed map action -- Start/Resume/Fit
   *  line -- folded in here as a sibling `type="button"`, the same
   *  shape Plan's own RouteForm holds "Brief" next to "Chart" in. One
   *  merged header row for both pages now, not a form here and a
   *  floating corner button over the map there. */
  onToggleView: () => void;
  toggleViewDisabled: boolean;
  toggleViewLabel: string;
}

export default function RouteForm({
  dep, dest, onDepChange, onDestChange, onSubmit,
  onToggleView, toggleViewDisabled, toggleViewLabel,
}: Props) {
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={e => {
        e.preventDefault();
        // Without this, focus stays on whichever input was last
        // typed in, and the keyboard handler ignores every key while
        // an input has focus -- so Space wouldn't start the walk
        // right after loading a route, only after clicking the map.
        (document.activeElement as HTMLElement | null)?.blur();
        onSubmit();
      }}
    >
      <div className="flex items-center gap-2">
        {/* Same size as Plan's own DEP/DEST inputs now (see that
            RouteForm's own comment on why the width is what it is) --
            this page used to run these taller (h-10, deliberately
            bigger tap targets) than Plan's did, one more place the two
            pages looked like different designs rather than the same
            shell around a different sidebar. */}
        <Input
          value={dep}
          onChange={e => onDepChange(e.target.value.toUpperCase())}
          aria-label="Departure"
          className="w-20 text-center font-mono uppercase"
        />
        <span>&rarr;</span>
        <Input
          value={dest}
          onChange={e => onDestChange(e.target.value.toUpperCase())}
          aria-label="Destination"
          className="w-20 text-center font-mono uppercase"
        />
      </div>
      <Button type="submit">Load</Button>
      <Button
        type="button" onClick={onToggleView} disabled={toggleViewDisabled}
        data-testid="map-action-button"
      >
        {toggleViewLabel}
      </Button>
    </form>
  );
}
