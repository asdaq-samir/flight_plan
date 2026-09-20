import { useEffect, type RefObject } from "react";

/**
 * Opens every `<details>` inside `container` for the print itself, then
 * restores whatever the reader actually had open. A collapsed
 * `<details>` renders nothing to print, `print:` overrides on its own
 * children notwithstanding -- Chromium's closed-state styling for it
 * isn't plain `display:none` on those children (which an author
 * override could win against) but a zero-size internal content box
 * the children's own display value doesn't affect. The one override
 * that reliably works everywhere is opening every section for the
 * print: `beforeprint`/`afterprint` fire around the briefing's own
 * Print button and a browser's native Ctrl+P alike.
 */
export function useDetailsOpenForPrint(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const openBeforePrint = new WeakMap<HTMLDetailsElement, boolean>();
    const beforePrint = () => {
      container.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(d => {
        openBeforePrint.set(d, d.open);
        d.open = true;
      });
    };
    const afterPrint = () => {
      container.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(d => {
        // `?? false`, not `?? d.open` -- by this point every details
        // has already been forced open, so reading its own `open` as
        // the fallback would just keep it open forever. `false` is the
        // right default for one that didn't exist yet at beforePrint
        // (a section mounting between the two events) -- it was never
        // open in the first place.
        d.open = openBeforePrint.get(d) ?? false;
      });
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [container]);
}
