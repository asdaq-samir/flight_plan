import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { TEXT } from "../../../lib/text";

/** The times on the ground a stop is picked from, min. */
const CHOICES = [15, 30, 45, 60, 90, 120];

/** Minutes as the menu says them: "45 min", "1 h 30 min". */
function said(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * A stop's time on the ground, picked from a menu, at the owner's pick of
 * the audit's choices (2026-10-20): 30 minutes where none is picked, and
 * the flights after the stop leave that much later (the planner's
 * TURNAROUND_MIN). A chip's size, as the procedures' pull-downs are, its
 * 44-point area a pseudo-element round it; discrete times, so a menu,
 * not a slider.
 */
export default function GroundMenu({ ident, minutes, onPick }: { ident: string; minutes: number; onPick: (minutes: number) => void }) {
  const choices = CHOICES.includes(minutes) ? CHOICES : [...CHOICES, minutes].sort((a, b) => a - b);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button" data-testid="ground-menu"
          className={cn(
            "relative flex h-8 w-fit min-w-0 items-center gap-0.5 rounded-full bg-foreground/8 px-2.5 font-semibold text-tint outline-none",
            "after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail,
          )}
          aria-label={`Time on the ground at ${ident}: ${said(minutes)}`}
        >
          <span className="truncate">{said(minutes)} on the ground</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>On the ground at {ident}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(minutes)} onValueChange={value => onPick(Number(value))}>
          {choices.map(choice => (
            <DropdownMenuRadioItem key={choice} value={String(choice)} data-testid={`ground-${choice}`}>{said(choice)}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
