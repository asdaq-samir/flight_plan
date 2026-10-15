import type { ReactNode } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";

/** A part of a tab that is not a section of its own -- En route's legs,
 *  its totals and table -- under its title (`heading`) as a section's is
 *  (AccordionSection), and found by it (`data-title`, PanelTabs' scroll to
 *  a section asked for). */
export function SectionPane({ title, heading = false, children }: { title: string; heading?: boolean; children: ReactNode }) {
  return (
    <div data-title={title} className={cn(heading && "border-b py-4 last:border-b-0")}>
      {heading && <h3 className={cn("mb-2 font-medium", TEXT.title)}>{title}</h3>}
      {children}
    </div>
  );
}
