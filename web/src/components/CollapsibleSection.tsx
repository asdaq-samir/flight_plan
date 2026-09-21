import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/** A titled section that opens and closes -- shadcn's own `Collapsible`
 *  (Radix), styled as a card: the Flight Briefing's sections and the
 *  nav log's own fold when the drawer is wide. Collapsed by default
 *  unless `defaultOpen` says otherwise.
 *
 *  `forceMount` on the content: Radix's default unmounts a closed
 *  section's content, and a printed briefing then lost every section
 *  the reader had left closed. Mounted and merely hidden, the content
 *  is there for the print stylesheet to show (`print:!block`, below),
 *  which is the whole of what a native `<details>` used to be kept
 *  around for. Printed, the card chrome goes too: one flat sheet, a
 *  rule between sections, no shadow to fail to render. */
interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function CollapsibleSection({ title, children, defaultOpen, onOpenChange }: CollapsibleSectionProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className="group/section mx-2 my-1.5 break-inside-avoid-page rounded-xl bg-card shadow-xs ring-1 ring-foreground/10 print:m-0 print:break-inside-avoid print:rounded-none print:bg-transparent print:shadow-none print:ring-0 print:[&:not(:last-child)]:border-b print:[&:not(:last-child)]:border-border"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:rounded-b-none print:cursor-default print:hover:bg-transparent">
        {title}
        <ChevronDown className="ml-auto size-4 shrink-0 transition-transform group-data-[state=open]/section:rotate-180" />
      </CollapsibleTrigger>
      {/* Radix keeps force-mounted content visible; `data-[state=closed]:hidden`
          is what closes it on screen, and the print rule in index.css
          is what shows it on paper regardless. */}
      <CollapsibleContent forceMount className="border-t border-border px-3 py-3 data-[state=closed]:hidden print:!block">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
