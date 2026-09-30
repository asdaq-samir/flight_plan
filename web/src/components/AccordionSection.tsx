import type { ComponentProps, ReactNode } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";

/**
 * One section of a folded list -- the flight planning drawer's, and
 * the developer console's System tab -- as a shadcn Accordion item
 * whose value is its own title, so the drawer (NavLogView) can name
 * every section to open for the printer. The look and the keys are the
 * stock accordion's -- a title that opens on a click, Up and Down
 * between titles, a rule between sections -- and nothing of its own.
 * The trigger used to swallow Up and Down so that a hand-bound walk on
 * the page could have them instead; both are gone. A `description` is
 * the first line inside, so a folded section is its one bold line.
 */
export default function AccordionSection({ title, description, aside, children, ...props }: {
  title: string; description?: string;
  /** Beside the title, shown folded or open: what a folded section
   *  must say without being opened (the briefing's VFR-not-recommended). */
  aside?: ReactNode;
  children: ReactNode;
} & Omit<ComponentProps<typeof AccordionItem>, "value" | "title">) {
  return (
    <AccordionItem value={title} {...props}>
      {/* Bold, over the stock trigger's medium: a section title is what
          the drawer is read by, and medium read as one more line. */}
      <AccordionTrigger className="font-semibold">
        {aside ? <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{title}{aside}</span> : title}
      </AccordionTrigger>
      <AccordionContent>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
