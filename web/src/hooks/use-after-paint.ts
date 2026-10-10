import { useEffect, useState } from "react";

/**
 * False as a component is first drawn, true once that frame has been
 * painted: a part drawn only then is a task of its own after the paint,
 * not more of the long one that drew the rest. A requestAnimationFrame
 * runs just before the frame is painted, and a timeout set there just
 * after it.
 */
export function useAfterPaint(): boolean {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    let timer = 0;
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setPainted(true)); });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);
  return painted;
}
