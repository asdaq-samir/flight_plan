import { useContext, useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { TEXT } from "../lib/text";
import { SectionsOpen } from "./sectionLayout";

/**
 * One section of a folded list -- the flight planning drawer's, and
 * the developer console's System tab -- as a shadcn Accordion item
 * whose value is its own title, so the drawer (NavLogView) can name
 * every section to open for the printer. The look and the keys are the
 * stock accordion's -- a title that opens on a click, Up and Down
 * between titles, a rule between sections -- and nothing of its own.
 * The trigger used to swallow Up and Down so that a hand-bound walk on
 * the page could have them instead; both are gone. A `description` is
 * the first line inside; a `summary` is a line under the title, folded
 * or open, so the drawer can be read without opening every section.
 *
 * The title, its aside and its summary are laid over the trigger, not
 * inside it (the trigger's `label`): an aside may be a control of its
 * own (a flag that opens a note), and inside the trigger it was a button
 * in a button, which a screen reader cannot reach. The trigger is still
 * the whole row's tap and is named by the title, the summary its
 * description.
 *
 * Inside the planning panel's tabs (SectionsOpen) a section is laid open
 * instead -- its title, its aside and its content, no fold: a tab is one
 * thing already, and a fold in it was a second tap to read it.
 */
export default function AccordionSection({ title, description, aside, summary, children, ...props }: {
  title: string; description?: string;
  /** Beside the title, shown folded or open: what a folded section
   *  must say without being opened (the briefing's VFR-not-recommended). */
  aside?: ReactNode;
  /** Under the title, folded or open: the section in one line (the
   *  briefing's "KDLH 500 ft · 3 sm"). */
  summary?: ReactNode;
  children: ReactNode;
} & Omit<ComponentProps<typeof AccordionItem>, "value" | "title">) {
  const titleId = useId();
  const summaryId = useId();
  const laidOpen = useContext(SectionsOpen);
  if (laidOpen) {
    return (
      // Laid out and painted only near the screen (content-visibility): a
      // tab of them -- the weather's five, the airports' lists -- drew all
      // of its length on opening.
      <section
        aria-labelledby={titleId} data-slot="open-section" data-title={title}
        className={cn("border-b py-4 [contain-intrinsic-size:auto_24rem] [content-visibility:auto] last:border-b-0 print:[content-visibility:visible]", TEXT.prose)}
      >
        {/* The heading its title alone, the flag beside it: inside it, a
            flag's words ("Risk raised") became part of the heading's name. */}
        <div className={cn("mb-2 flex flex-wrap items-center gap-x-2 gap-y-1", TEXT.row)}>
          <h3 id={titleId} className={cn("font-semibold", TEXT.heading)}>{title}</h3>
          {aside}
        </div>
        {description && <div className={cn("text-muted-foreground", TEXT.note)}>{description}</div>}
        {children}
      </section>
    );
  }
  return (
    <AccordionItem value={title} {...props}>
      {/* Bold, over the stock trigger's medium: a section title is what
          the drawer is read by, and medium read as one more line. At a
          row's size (TEXT), its summary and its words at what is read,
          and its line of help a note's: 17, 15 and 13 to a finger, where
          the title was 14 over rows of 17. Taps fall through the label
          to the trigger under it, but for the aside's own; it underlines
          and fades with the trigger, as its words did inside it. */}
      <AccordionTrigger
        aria-labelledby={titleId} aria-describedby={summary ? summaryId : undefined}
        label={(
          <span
            className={cn(
              "pointer-events-none col-start-1 row-start-1 flex min-w-0 flex-col gap-0.5 self-start py-4 pr-6 text-left font-semibold",
              "group-hover/accordion-header:underline pointer-coarse:group-has-[[data-slot=accordion-trigger]:active]/accordion-header:opacity-60",
              TEXT.row,
            )}
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span id={titleId}>{title}</span>
              {aside && <span className="pointer-events-auto inline-flex">{aside}</span>}
            </span>
            {summary && (
              <span id={summaryId} className={cn("font-normal text-muted-foreground", TEXT.prose)} data-slot="section-summary">{summary}</span>
            )}
          </span>
        )}
      />
      <AccordionContent className={TEXT.prose}>
        {description && <div className={cn("text-muted-foreground", TEXT.note)}>{description}</div>}
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
