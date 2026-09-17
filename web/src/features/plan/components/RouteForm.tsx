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
}

export default function RouteForm({
  dep, dest, alt, onDepChange, onDestChange, onAltChange, onSubmit, disabled, routes, summary,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="flex items-center gap-2"
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
        <Button type="submit" disabled={disabled}>Plan</Button>
      </form>
      <span className="text-muted-foreground">{summary}</span>
    </div>
  );
}
