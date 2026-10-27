import { Fragment, type ReactElement, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { TEXT } from "../lib/text";

/** One of a pull-down's choices. */
export interface PullDownOption<V extends string> {
  value: V;
  /** Its row in the menu, and the trigger's words while it is the one. */
  label: ReactNode;
  /** Its words to a screen reader where the label is more than words (a
   *  picture beside them). */
  text?: string;
  testId?: string;
  /** A group's band after it. */
  apart?: boolean;
}

/**
 * Every pick-one choice in the app, as iOS's pull-down button is: the one
 * picked in the tint with the up-and-down chevron, and a tap the menu of
 * them, the picked one's checkmark on the left (the owner's "one pull-down
 * for every pick-one", 2026-10-27). It was three things -- Radix's Select
 * with its own list, radio items in a DropdownMenu, and the procedures'
 * menu -- each looking its own. The stock DropdownMenu's radio group
 * underneath, so it is a menu to a screen reader and the keyboard, its
 * look the app's one menu look (ui/menuLook).
 */
export default function PullDown<V extends string>({
  label, value, options, onChange, placeholder, testId, align = "end", trigger, className, contentClassName, top,
}: {
  /** What is picked, to a screen reader: "Time aloft", said with the one
   *  picked ("Time aloft: 1 h"). */
  label: string;
  /** The one picked; one not among the options shows the placeholder. */
  value: V | "";
  options: PullDownOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  /** The trigger's. */
  testId?: string;
  align?: "start" | "center" | "end";
  /** A trigger of the caller's own -- a chip, a glyph -- in place of the
   *  tinted words; it says its own name. */
  trigger?: ReactElement;
  /** The tinted words' trigger's. */
  className?: string;
  contentClassName?: string;
  /** Before the choices, a band under it. */
  top?: ReactNode;
}) {
  const picked = options.find(o => o.value === value);
  const words = picked ? picked.text ?? (typeof picked.label === "string" ? picked.label : picked.value) : placeholder ?? "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          // Its 44-point area a pseudo-element round the words, never a
          // bigger button (index.css's rule for every control).
          <button
            type="button" aria-label={`${label}: ${words}`} data-testid={testId}
            className={cn(
              "relative inline-flex min-w-0 items-center gap-1 rounded-sm text-tint outline-none",
              "after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring",
              "[&_svg]:shrink-0",
              TEXT.row, className,
            )}
          >
            <span className={cn("flex min-w-0 items-center gap-1.5 truncate", !picked && "text-muted-foreground")}>{picked?.label ?? placeholder}</span>
            <ChevronsUpDown className="size-4" aria-hidden="true" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {top && (
          <>
            {top}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup value={value} onValueChange={v => onChange(v as V)} aria-label={label}>
          {options.map(o => (
            <Fragment key={o.value}>
              <DropdownMenuRadioItem value={o.value} data-testid={o.testId} aria-label={o.text}>{o.label}</DropdownMenuRadioItem>
              {o.apart && <DropdownMenuSeparator />}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
