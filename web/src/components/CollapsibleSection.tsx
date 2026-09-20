import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** A `<details>` block with a consistent title style -- shared by the
 *  Flight Briefing page and Settings, both of which are "skim titles,
 *  open what's relevant" pages rather than a single continuous
 *  document. Collapsed by default unless `defaultOpen` says otherwise
 *  (the briefing's own summary is the one section a pilot always
 *  wants). `print:break-inside-avoid` (and `break-inside-avoid-page`)
 *  only matter on the Flight Briefing page, which prints; they're inert
 *  elsewhere.
 *
 *  Native `<details>`, not shadcn's `Collapsible` (Radix): zero
 *  library code -- a browser primitive, not an import -- and it
 *  fixes a real regression the Radix version had: Radix unmounts
 *  closed content entirely, so a printed page with any section left
 *  collapsed was missing it; `<details>` never removes its content
 *  from the DOM, only hides it, which is what this page's own print
 *  stylesheet (scoped to `.flight-briefing` in index.css) can actually
 *  override without changing other screens' printed disclosure state.
 *  Styled as its own card (ring, rounded corners, shadow -- shadcn's
 *  `Card` look, white whether open or closed, with a rule under the
 *  title once open so the content reads as the card's body rather than
 *  a grey well the tables and inputs float in) rather than a row in a
 *  bordered list: each section reads as a distinct block you open, not
 *  a line in a continuous sheet. Printed, that card chrome (ring/shadow/
 *  margin/rounding) is stripped back to a plain bordered row -- the
 *  same "one flat sheet" look a paper checklist wants, where a shadow
 *  can't render and a gap between cards is just wasted paper. */
interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function CollapsibleSection({ title, children, defaultOpen, onOpenChange }: CollapsibleSectionProps) {
  return (
    <details
      open={defaultOpen}
      className="group mx-2 my-1.5 break-inside-avoid-page rounded-xl bg-card shadow-xs ring-1 ring-foreground/10 print:m-0 print:break-inside-avoid print:rounded-none print:bg-transparent print:shadow-none print:ring-0 print:[&:not(:last-child)]:border-b print:[&:not(:last-child)]:border-border"
      onToggle={event => onOpenChange?.(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground outline-none transition-colors group-open:rounded-b-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 print:cursor-default print:hover:bg-transparent [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-3 py-3">{children}</div>
    </details>
  );
}
