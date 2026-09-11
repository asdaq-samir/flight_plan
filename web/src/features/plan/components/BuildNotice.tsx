interface Props {
  dep: string;
  dest: string;
  building: string | null;
  onBuild: () => void;
}

/** The one recoverable failure: the corridor exists but nobody has
 *  collected it yet, and the page can start that job itself. */
export default function BuildNotice({ dep, dest, building, onBuild }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      <span>{dep} → {dest} has not been collected yet. This takes a few minutes.</span>
      <button
        disabled={building !== null}
        onClick={onBuild}
        className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Collect this route
      </button>
      <span className="text-slate-600">{building}</span>
    </div>
  );
}
