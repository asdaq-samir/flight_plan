import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * A keyboard shortcut, styled like the physical key it refers to --
 * a plain `<kbd>` renders in monospace with no visual box by default,
 * easy to misread as just part of the surrounding sentence rather
 * than something to press.
 */
export default function Key({ children }: Props) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 shadow-sm">
      {children}
    </kbd>
  );
}
