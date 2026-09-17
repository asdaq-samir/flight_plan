import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";

/** A collapsed-by-default section with a consistent title style --
 *  shared by the Flight Briefing page and the Playground, both of
 *  which are "skim titles, open what's relevant" pages rather than a
 *  single continuous document.
 *
 *  shadcn's `Collapsible` (Radix) unmounts its content while closed,
 *  which means a collapsed section currently has nothing for the
 *  Flight Briefing page's print stylesheet to force open (see
 *  `@media print` in index.css) -- printing a page with any section
 *  left collapsed will be missing that section until this gets a
 *  print-specific fix. Known tradeoff, deferred deliberately rather
 *  than kept on native `<details>`. */
export default function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="break-inside-avoid-page border-b border-slate-200 px-4 py-3 print:break-inside-avoid">
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-slate-500 print:cursor-default">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}
