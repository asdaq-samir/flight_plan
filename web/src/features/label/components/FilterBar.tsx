import { FILTER_KEYS, type FilterKey, type Filters } from "../logic";

interface Props {
  filters: Filters;
  onChange: (key: FilterKey, on: boolean) => void;
  shown: number;
}

export default function FilterBar({ filters, onChange, shown }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>Showing: <b>{shown}</b></span>
      <span className="flex flex-wrap items-center gap-2" title="Which waypoints to show and count">
        {FILTER_KEYS.map(key => (
          <label key={key} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={filters[key]} onChange={e => onChange(key, e.target.checked)} />
            {key === "dr" ? "DR" : key}
          </label>
        ))}
      </span>
    </div>
  );
}
