import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
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
        {/* h-10, not shadcn's own h-9 default -- deliberately larger
            tap targets for a workflow that's otherwise all one-handed
            map taps and keyboard shortcuts, matching the "Load"
            button's own `size="lg"` next to it. */}
        <Input
          value={dep}
          onChange={e => onDepChange(e.target.value.toUpperCase())}
          aria-label="Departure"
          className="h-10 w-20 text-center font-mono uppercase"
        />
        <span>&rarr;</span>
        <Input
          value={dest}
          onChange={e => onDestChange(e.target.value.toUpperCase())}
          aria-label="Destination"
          className="h-10 w-20 text-center font-mono uppercase"
        />
        <Button type="submit" size="lg">Load</Button>
      </form>
      {course && (
        <div className="text-sm leading-tight text-muted-foreground">
          <div><b className="text-foreground">{course.distance_nm}</b> nm</div>
          <div>{String(course.bearing_deg).padStart(3, "0")}°T</div>
        </div>
      )}
    </div>
  );
}
