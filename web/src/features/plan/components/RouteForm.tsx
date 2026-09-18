import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import type { BuiltRoute } from "../../../lib/api/types";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  routes: BuiltRoute[];
  /** Opens the Flight Briefing view for whatever route is currently
   *  charted (labeled "Brief" here, not "Flight Briefing" -- next to
   *  "Chart," the short form reads fine) -- a second action beside it,
   *  not a submit, so it's `type="button"` in the same row rather than
   *  its own form. Lives in the header, not floating over the map --
   *  the same place Label's own single most-needed action (Start/
   *  Resume/Fit line) lives too now, see Label's own RouteForm. */
  onOpenBriefing: () => void;
  briefingDisabled: boolean;
}

export default function RouteForm({
  dep, dest, onDepChange, onDestChange, onSubmit, disabled, routes,
  onOpenBriefing, briefingDisabled,
}: Props) {
  return (
    // flex-wrap, not a fixed single line -- DEP/DEST need their full
    // width to actually show a 4-letter ident (a narrower box clips
    // the text itself, not just the row around it, which is worse:
    // wrong-looking data, not just a layout that needs a scroll or a
    // second glance). Wrapping onto a second line on a narrow phone
    // screen costs nothing here; a hidden/clipped identifier would.
    <form
      className="flex flex-wrap items-center gap-1.5"
      autoComplete="off"
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
    >
      <Input
        value={dep}
        onChange={e => onDepChange(e.target.value)}
        list="built"
        placeholder="DEP"
        spellCheck={false}
        aria-label="Departure"
        className="w-20 text-center font-mono uppercase"
      />
      <span>→</span>
      <Input
        value={dest}
        onChange={e => onDestChange(e.target.value)}
        list="built"
        placeholder="DEST"
        spellCheck={false}
        aria-label="Destination"
        className="w-20 text-center font-mono uppercase"
      />
      <datalist id="built">
        {[...new Set(routes.flatMap(r => [r.departure_ident, r.destination_ident]))]
          .sort().map(id => <option key={id} value={id} />)}
      </datalist>
      <Button type="submit" disabled={disabled}>Chart</Button>
      <Button type="button" onClick={onOpenBriefing} disabled={briefingDisabled} data-testid="map-action-button">
        Brief
      </Button>
    </form>
  );
}
