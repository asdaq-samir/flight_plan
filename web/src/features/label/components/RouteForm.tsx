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
    <div className="flex items-center gap-3">
      <span className="font-bold">Route</span>
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
        <input
          value={dep}
          onChange={e => onDepChange(e.target.value.toUpperCase())}
          aria-label="Departure"
          className="w-20 rounded border border-slate-300 px-2 py-1 text-center font-mono uppercase"
        />
        <span>&rarr;</span>
        <input
          value={dest}
          onChange={e => onDestChange(e.target.value.toUpperCase())}
          aria-label="Destination"
          className="w-20 rounded border border-slate-300 px-2 py-1 text-center font-mono uppercase"
        />
        <button type="submit" className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700">
          Load
        </button>
      </form>
      {course && (
        <span className="text-slate-600">
          <b className="text-slate-900">{course.distance_nm}</b> nm ·{" "}
          {String(course.bearing_deg).padStart(3, "0")}°T
        </span>
      )}
    </div>
  );
}
