import type { ReactNode } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "../../../../components/ui/accordion";

/**
 * One section of the flight planning drawer: a shadcn Accordion item
 * whose value is its own title, so the drawer (NavLogView) can name
 * every section to open for the printer. The look is the stock
 * accordion's -- a title that opens on a click, a rule between
 * sections -- and nothing of its own.
 */
export default function BriefingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AccordionItem value={title}>
      {/* Up and Down walk the route's checkpoints on this page
          (PlanView's own keys), and a pilot who has just clicked a
          title is still on it: the stock accordion's Up/Down between
          titles gives way to that (the default is prevented before
          Radix sees it; PlanView lets a prevented press through from a
          title). Home, End and Tab still move between titles. */}
      <AccordionTrigger onKeyDown={e => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}>
        {title}
      </AccordionTrigger>
      <AccordionContent>{children}</AccordionContent>
    </AccordionItem>
  );
}
