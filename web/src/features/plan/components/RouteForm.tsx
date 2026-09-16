import Button from "../../../components/Button";
import { FIELD_INPUT } from "../../../components/fieldInput";
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
        <input
          value={dep}
          onChange={e => onDepChange(e.target.value)}
          list="built"
          placeholder="DEP"
          spellCheck={false}
          aria-label="Departure"
          className={`w-20 text-center font-mono uppercase ${FIELD_INPUT}`}
        />
        <span>→</span>
        <input
          value={dest}
          onChange={e => onDestChange(e.target.value)}
          list="built"
          placeholder="DEST"
          spellCheck={false}
          aria-label="Destination"
          className={`w-20 text-center font-mono uppercase ${FIELD_INPUT}`}
        />
        <datalist id="built">
          {[...new Set(routes.flatMap(r => [r.departure_ident, r.destination_ident]))]
            .sort().map(id => <option key={id} value={id} />)}
        </datalist>
        <input
          value={alt}
          onChange={e => onAltChange(e.target.value)}
          placeholder="alt (auto)"
          spellCheck={false}
          aria-label="Cruise altitude, feet"
          className={`w-28 ${FIELD_INPUT}`}
        />
        <Button type="submit" disabled={disabled}>Plan</Button>
      </form>
      <span className="text-slate-600">{summary}</span>
    </div>
  );
}
