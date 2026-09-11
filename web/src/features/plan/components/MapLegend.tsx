import Card from "../../../components/Card";

interface Props {
  basemap: string;
  onFit: () => void;
}

/** Checkpoint/candidate dot key plus the map shortcuts -- the plan-page
 *  equivalent of the labeler's RatingLegend, folded into the sidebar. */
export default function MapLegend({ basemap, onFit }: Props) {
  return (
    <Card title="Map">
      <div className="space-y-2 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#1a7f37" }} />
          checkpoint (score-coloured)
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#96a7b2" }} />
          candidate considered
        </div>
        <div className="border-t border-slate-200 pt-2 space-y-1">
          <div><kbd>a</kbd> candidates · <kbd>n</kbd> nav log</div>
          <div><kbd>t</kbd> basemap: <b>{basemap}</b></div>
          <button
            type="button"
            onClick={onFit}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
          >
            Fit route <kbd>f</kbd>
          </button>
        </div>
      </div>
    </Card>
  );
}
