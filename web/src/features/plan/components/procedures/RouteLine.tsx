import { ChevronDown, Route } from "lucide-react";
import { cn } from "cn";
import { ToggleGroup, ToggleGroupItem } from "../../../../components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import { TEXT } from "../../../../lib/text";
import { useRouteLineOpen } from "../../../../lib/routeLine";

/** FPL's route line's choices (PlanWorkspace's routeLine): each chip's
 *  key and words, and what its way meets, in amber; the one picked. */
export interface RouteLineChoices {
  /** Each way: its key, name, what it meets and its whole time ("2h 59m"). */
  chips: { key: string; label: string; warning: string | null; time: string | null }[];
  picked: string;
  onPick: (key: string) => void;
}

/**
 * FPL's Routes, over the route's fields, at the owner's pick of the
 * canvas's K1 (2026-10-29): folded, one row -- the route's glyph, the way
 * flown and its time, how many more there are; open, its heading and the
 * planner's ways as cards, each its time over its name, a tap on one the
 * route at once ("None" is the route as typed). It was a tray under the
 * departure's row, folded to the way picked, as a runway line is. Open
 * until its row folds it (the owner, 2026-10-28: "Keep the routes and
 * runway opened until folded"). A way that meets something says so in
 * amber, in its name too: the planner warns, never refuses.
 */
/** The Routes row. `grouped`: inside Route Cards' head box (PlanWorkspace),
 *  under the airplane and the altitude, the box's fill and corners its
 *  own; else a rounded row of its own over the list. */
export function RouteLine({ line, grouped = false }: { line: RouteLineChoices; grouped?: boolean }) {
  const open = useRouteLineOpen(s => s.open);
  const picked = line.chips.find(c => c.key === line.picked) ?? line.chips[0]!;
  const words = (c: RouteLineChoices["chips"][number]) =>
    `${c.key === "none" ? "None, the route as typed" : c.label}${c.time ? `, ${c.time}` : ""}${c.warning ? `, ${c.warning.toLowerCase()}` : ""}`;
  const others = line.chips.length - 1;
  return (
    <Collapsible open={open} onOpenChange={next => useRouteLineOpen.setState({ open: next })} className={grouped ? undefined : "mt-2 mb-1 rounded-xl bg-card"} data-testid="route-line">
      <CollapsibleTrigger asChild>
        <button
          type="button" data-testid="route-line-toggle" data-disclosure=""
          aria-label={open ? "Routes: fold" : `Routes: ${words(picked)}, ${others} more`}
          className={cn("flex min-h-11 w-full items-center gap-2.5 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.row)}
        >
          <Route className="size-5 shrink-0 text-tint" aria-hidden />
          {open ? (
            <span className="flex-1 font-semibold">Routes</span>
          ) : (
            <span className="min-w-0 flex-1 truncate" data-testid="route-line-picked" data-key={picked.key}>
              {picked.label}{picked.time && <span className="font-semibold"> {picked.time}</span>}
            </span>
          )}
          {!open && others > 0 && <span className={cn("shrink-0 text-muted-foreground", TEXT.detail)}>{others} more</span>}
          <ChevronDown className={cn("size-4 shrink-0 text-tint transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToggleGroup
          type="single" value={line.picked} onValueChange={v => { if (v) line.onPick(v); }} aria-label="Routes"
          className="flex w-full justify-start gap-2 overflow-x-auto px-3 pb-3 [scrollbar-width:none]"
        >
          {line.chips.map(c => (
            <ToggleGroupItem
              key={c.key} value={c.key} aria-label={words(c)} data-testid="route-line-chip" data-key={c.key}
              className={cn(
                "h-auto min-w-24 max-w-44 shrink-0 flex-col items-start gap-0.5 rounded-xl border border-border bg-background px-2.5 py-2 text-left",
                "data-[state=on]:border-2 data-[state=on]:border-tint data-[state=on]:bg-tint/12",
              )}
            >
              <span className={cn("font-semibold", TEXT.row, c.key === line.picked && "text-tint")}>{c.time ?? "—"}</span>
              <span className={cn("whitespace-normal", TEXT.note, c.warning ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>{c.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}
