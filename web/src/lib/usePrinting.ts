import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Whether the page is being printed: set in the browser's own
 * beforeprint event, flushed before it lays the page out, and put back
 * after -- so what is folded on screen (a tab not up, a step of the
 * altitude's reasoning) is laid open on paper.
 */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return printing;
}
