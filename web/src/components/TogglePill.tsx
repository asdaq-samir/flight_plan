import type { ReactNode } from "react";
import { Toggle } from "./ui/toggle";
import { cn } from "cn";
import { TEXT } from "../lib/text";

/**
 * Something on or off, as a pill of its own: filled in the tint while
 * on, an outline while off, apart from any other -- so it cannot be
 * taken for a segment of a segmented control (Segmented), which picks
 * one of several, or for the console's tabs, which change the page.
 * The stock Toggle, its pressed state `aria-pressed`. Class B's Weather
 * and TAC were two segments of a track, and Waypoints Show and Hide,
 * and read as a choice between them.
 */
export default function TogglePill({ pressed, onPressedChange, icon, label, testId, disabled }: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: ReactNode;
  label: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <Toggle
      pressed={pressed} onPressedChange={onPressedChange} size="sm" data-testid={testId} disabled={disabled}
      className={cn("h-7 gap-1.5 rounded-full border border-border px-3 text-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:aria-pressed:bg-primary/90 [&_svg:not([class*='size-'])]:size-3.5", TEXT.note)}
    >
      {icon}
      {label}
    </Toggle>
  );
}
