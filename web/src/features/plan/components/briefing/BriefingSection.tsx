import type { ReactNode } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "../../../../components/ui/accordion";

/**
 * One section of the flight planning drawer: a shadcn Accordion item
 * whose value is its own title, so the drawer (NavLogView) can name
 * every section to open for the printer. The look and the keys are the
 * stock accordion's -- a title that opens on a click, Up and Down
 * between titles, a rule between sections -- and nothing of its own.
 * The trigger used to swallow Up and Down so that a hand-bound walk on
 * the page could have them instead; both are gone.
 */
export default function BriefingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AccordionItem value={title}>
      <AccordionTrigger>{title}</AccordionTrigger>
      <AccordionContent>{children}</AccordionContent>
    </AccordionItem>
  );
}
