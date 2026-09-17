import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import type { BuiltRoute } from "../../../lib/api/types";

interface Props {
  dep: string;
  dest: string;
  alt: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onAltChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  routes: BuiltRoute[];
  summary: string;
  /** Opens the Flight Briefing view for whatever route is currently
   *  charted (labeled "Briefing" here -- "Flight" doesn't earn its own
   *  word next to "Chart") -- a second action beside it, not a submit,
   *  so it's `type="button"` in the same row rather than its own form.
   *  Lives here (not floating over the map, `MapActionButton`'s own
   *  spot for every other page's single most-needed action) because it
   *  isn't this page's single most-needed action -- Chart is -- just
   *  the one other thing worth reaching without a trip to the header
   *  first. */
  onOpenBriefing: () => void;
  briefingDisabled: boolean;
}

export default function RouteForm({
  dep, dest, alt, onDepChange, onDestChange, onAltChange, onSubmit, disabled, routes, summary,
  onOpenBriefing, briefingDisabled,
}: Props) {
  return (
    // No flex-wrap -- this scrolls horizontally instead of wrapping
    // to a second line on a narrow phone screen, since the header
    // that renders this (PlanView's own `mapHeader`) also has the
    // Settings gear to fit on the same row, and a route with an
    // "alt (auto)" field, Chart, and Briefing all showing at once is
    // simply wider than a phone viewport at any font size worth
    // reading. `shrink-0` on the form itself so nothing here actually
    // shrinks and clips its own text -- scrolling, not squeezing, is
    // the fallback.
    <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
      <form
        className="flex shrink-0 items-center gap-2"
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
        <Input
          value={alt}
          onChange={e => onAltChange(e.target.value)}
          placeholder="alt (auto)"
          spellCheck={false}
          aria-label="Cruise altitude, feet"
          className="w-28"
        />
        <Button type="submit" disabled={disabled}>Chart</Button>
        <Button type="button" onClick={onOpenBriefing} disabled={briefingDisabled} data-testid="map-action-button">
          Briefing
        </Button>
      </form>
      <span className="text-muted-foreground">{summary}</span>
    </div>
  );
}
