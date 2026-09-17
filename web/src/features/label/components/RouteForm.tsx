import { Button } from "../../../components/ui/button";
import type { Course } from "../../../lib/api/types";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onSubmit: () => void;
  course: Course | null;
}

export default function RouteForm({ dep, dest, onDepChange, onDestChange, onSubmit, course }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="flex items-center gap-2"
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
        {/* py-2, not the shared FIELD_INPUT's py-1 -- deliberately
            larger tap targets for a workflow that's otherwise all
            one-handed map taps and keyboard shortcuts, matching the
            "Load" button's own `size="lg"` next to it. */}
        <input
          value={dep}
          onChange={e => onDepChange(e.target.value.toUpperCase())}
          aria-label="Departure"
          className="w-20 rounded border border-slate-300 px-2 py-2 text-center font-mono uppercase"
        />
        <span>&rarr;</span>
        <input
          value={dest}
          onChange={e => onDestChange(e.target.value.toUpperCase())}
          aria-label="Destination"
          className="w-20 rounded border border-slate-300 px-2 py-2 text-center font-mono uppercase"
        />
        <Button type="submit" size="lg">Load</Button>
      </form>
      {course && (
        <div className="text-sm leading-tight text-slate-600">
          <div><b className="text-slate-900">{course.distance_nm}</b> nm</div>
          <div>{String(course.bearing_deg).padStart(3, "0")}°T</div>
        </div>
      )}
    </div>
  );
}
