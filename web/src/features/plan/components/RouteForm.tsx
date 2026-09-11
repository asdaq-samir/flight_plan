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
      <span className="font-bold">VFR planner</span>
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
          className="w-20 rounded border border-slate-300 px-2 py-1 text-center font-mono uppercase"
        />
        <span>→</span>
        <input
          value={dest}
          onChange={e => onDestChange(e.target.value)}
          list="built"
          placeholder="DEST"
          spellCheck={false}
          aria-label="Destination"
          className="w-20 rounded border border-slate-300 px-2 py-1 text-center font-mono uppercase"
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
          className="w-28 rounded border border-slate-300 px-2 py-1"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Plan
        </button>
      </form>
      <span className="text-slate-600">{summary}</span>
    </div>
  );
}
