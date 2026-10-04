import type { ReactNode } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import {
  ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent,
} from "../../../../components/ResponsivePopover";
import { TEXT } from "../../../../lib/text";

/**
 * A mark beside the Nav Log's title, folded or open, that opens to what
 * it is about: amber for a warning (a tight altitude), red, with its
 * words, for what stops the plan (no legal altitude, RouteProblem), the
 * tint for what the pilot chose (planned through Class B). A
 * popover from `md` up, a sheet on a phone. It was a line of its own
 * across the panel, under the route.
 *
 * Beside the section's title, which lies over the accordion's button
 * rather than in it (AccordionSection): a mark that takes its own tap,
 * the section left as it was, and the popover placed against it.
 */
export default function TitleNote({ tone, icon, label, title, open, onOpenChange, testId, contentTestId, children }: {
  tone: "warning" | "destructive" | "info";
  /** The mark's own glyph, where it is not the tone's. */
  icon?: ReactNode;
  /** Words beside the mark ("No legal altitude"); a mark alone without. */
  label?: string;
  /** The sheet's heading on a phone, and the popover's name. */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  contentTestId: string;
  children: ReactNode;
}) {
  const toggle = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    onOpenChange(!open);
  };
  const Icon = tone === "warning" ? TriangleAlert : CircleAlert;
  const mark = icon ?? <Icon className="size-4 shrink-0" aria-hidden="true" />;
  return (
    <ResponsivePopover open={open} onOpenChange={onOpenChange}>
      <ResponsivePopoverAnchor asChild>
        <span
          role="button" tabIndex={0} aria-label={label ?? title} aria-expanded={open}
          onClick={toggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
          // Over the section button's own hit area, which lies across its
          // title, and a finger's 44 points round the mark (index.css's
          // rule is for buttons; this is a span).
          className={cn(
            "relative z-10 inline-flex min-h-6 items-center gap-1 rounded-full font-semibold outline-none after:absolute after:-inset-2.5 focus-visible:ring-2 focus-visible:ring-ring",
            tone === "warning" ? "text-amber-600 dark:text-amber-400" : tone === "info" ? "text-tint" : "text-red-700 dark:text-red-400",
            label ? TEXT.note : "size-6 justify-center",
          )}
          data-testid={testId}
        >
          {mark}
          {label}
        </span>
      </ResponsivePopoverAnchor>
      {/* Kept off the screen's edges, the panel's gutter's width. */}
      <ResponsivePopoverContent
        // Twelve off the mark, past its 44-point hit area.
        title={title} titleHidden collisionPadding={16} sideOffset={12}
        className="w-80" data-testid={contentTestId}
      >
        {/* Here, not on the content: a phone's sheet takes its own
            classes, and its words were the stock 14. */}
        <div className={cn("font-normal", TEXT.detail)}>{children}</div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
