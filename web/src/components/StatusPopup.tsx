import { useEffect, useState } from "react";

// How long a message stays up once it stops changing -- long enough
// to read a short line, short enough not to sit over the map once
// whatever it was reporting has moved on. Purely informational (no
// tab, nothing to click): the pilot doesn't need to act on progress
// the way they might need to act on an error, so it just goes away on
// its own.
const AUTO_HIDE_MS = 4000;

/**
 * A simple, momentary line right below the page's own top bar --
 * "Reading the chart 45%," "Planning… 60%," "Generating 12/21" --
 * that shows itself and then goes away, not a drawer to manage. Each
 * change to `progress` (including a fresh one arriving after a quiet
 * stretch) restarts the clock, so it stays up through a stream of
 * updates and only fades once they've actually stopped.
 */
export default function StatusPopup({ progress, top }: { progress: string | null; top: number }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!progress) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [progress]);

  if (!progress || !visible) return null;

  return (
    <div style={{ top }} className="absolute left-1/2 z-[1000] -translate-x-1/2">
      <div className="max-w-[16rem] rounded bg-black/55 px-2 py-0.5 text-center text-[11px] text-white/90 backdrop-blur-sm">
        {progress}
      </div>
    </div>
  );
}
