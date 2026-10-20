import type { ReactNode } from "react";
import { ChevronRight, MoveUpRight } from "lucide-react";
import { cn } from "cn";
import RoundButton from "../../../components/RoundButton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { altitudeLines, fixRoles, type BranchFix } from "../../../lib/procedures";
import { altFt } from "../../../lib/units";
import { TEXT } from "../../../lib/text";

/**
 * A procedure picked at a field, its fixes a branch off the route's line in
 * the order they are flown, as a git graph branches, at the owner's pick
 * ("expandable list of connected points like git graph", option 4 of the
 * fix canvas): folded to its name and how many fixes, open a row a fix
 * with its altitude -- the pilot's own to cross it at, in the tint, else
 * the chart's -- and Direct to it. Sent direct to one, the branch runs
 * straight there, the fixes before it greyed on a dashed spur, skipped. A
 * fix's row, or its altitude, opens its card (FixCard): the altitude set
 * there, as from the map. Folded and unfolded by the stock Collapsible.
 * Its head, after the field's runways, is the procedure's own pull-down
 * (`head`, ProcedureMenu), its kind and its fixes said under it, the fold
 * at its right (the owner's pick, option C of the procedures canvas).
 */
export default function FixBranch({ name, kind, head, fixes, direct, crossings, onDirect, onOpen }: {
  /** The procedure, as the route's box names it ("ILS 22 · ELD"). */
  name: string;
  /** Its kind as the head says it ("Approach"), and its pull-down. */
  kind: string;
  head: ReactNode;
  fixes: BranchFix[];
  direct: string | null;
  /** The pilot's own altitudes to cross fixes at, by fix. */
  crossings: Record<string, number>;
  onDirect: (fix: string | null) => void;
  onOpen: (fix: string) => void;
}) {
  const directAt = direct ? fixes.findIndex(f => f.ident === direct) : -1;
  const count = fixes.length ? ` · ${fixes.length} ${fixes.length === 1 ? "fix" : "fixes"}` : "";
  return (
    <Collapsible data-testid="fix-branch" data-kind={kind.toLowerCase()}>
      <div className="flex min-h-11 items-center gap-2">
        {/* The procedure's mark, a branch's head. */}
        <span aria-hidden="true" className="flex w-6 shrink-0 justify-center">
          <span className="size-2.5 rotate-45 border-2 border-white bg-[#4f46e5] outline outline-1 outline-[#4f46e5]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          {head}
          <span className={cn("text-muted-foreground", TEXT.note)}>{kind}{count}</span>
        </div>
        {fixes.length > 0 && (
          <CollapsibleTrigger asChild>
            <RoundButton label={`${name}, its fixes`} className="group text-tint" data-testid="fix-branch-toggle">
              <ChevronRight className="size-5 transition-transform group-data-[state=open]:rotate-90" />
            </RoundButton>
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent>
        <ol className="mt-1" aria-label={`${name}, its fixes`}>
          {fixes.map((fix, i) => {
            const skipped = directAt > 0 && i < directAt;
            const isDirect = i === directAt;
            const own = crossings[fix.ident] ?? null;
            const charted = altitudeLines(fix).lines[0] ?? null;
            const roles = fixRoles(fix).join(" · ");
            const sub = isDirect ? `${roles ? `${roles} · ` : ""}direct to` : skipped ? `${roles ? `${roles} · ` : ""}skipped` : roles;
            return (
              <li key={`${fix.ident}-${i}`} className={cn("relative flex min-h-12 items-center gap-2 pl-7", isDirect && "rounded-xl bg-tint/8")} data-testid="fix-branch-row" data-fix={fix.ident}>
                {/* The branch's line and the fix's mark: dashed and hollow where
                    skipped, a filled tint dot where the airplane is sent. */}
                <span aria-hidden="true" className={cn("absolute top-0 bottom-0 left-3 border-l-2", skipped ? "border-dashed border-muted-foreground/40" : "border-[#4f46e5]", i === 0 && "top-1/2", i === fixes.length - 1 && "bottom-1/2")} />
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-1/2 left-3 -translate-x-[calc(50%-1px)] -translate-y-1/2",
                    isDirect ? "size-3.5 rounded-full border-2 border-white bg-tint" : cn("size-2.5 rotate-45 border-2", skipped ? "border-muted-foreground/40 bg-background" : "border-white bg-[#4f46e5]"),
                  )}
                />
                <button type="button" onClick={() => onOpen(fix.ident)} className={cn("flex min-w-0 flex-1 flex-col py-1 text-left", skipped && "opacity-50")}>
                  <span className={cn("font-semibold", TEXT.row, isDirect && "text-tint")}>{fix.ident}</span>
                  {sub && <span className={cn(TEXT.note, isDirect ? "font-semibold text-tint" : "text-muted-foreground")}>{sub}</span>}
                </button>
                <button
                  type="button" onClick={() => onOpen(fix.ident)} data-testid="fix-branch-altitude"
                  aria-label={own != null ? `${fix.ident}, cross at ${altFt(own)} ft: change` : `${fix.ident}, set an altitude to cross it at`}
                  className={cn(
                    "relative h-8 min-w-16 shrink-0 rounded-lg px-2 tabular-nums after:absolute after:-inset-y-1.5 after:content-['']", TEXT.detail,
                    own != null ? "bg-primary font-semibold text-primary-foreground" : "bg-foreground/6 text-muted-foreground",
                  )}
                >
                  {own != null ? altFt(own) : charted ? (
                    <span style={{ textDecoration: [charted.under && "underline", charted.over && "overline"].filter(Boolean).join(" ") || "none" }}>{charted.text}</span>
                  ) : "Alt"}
                </button>
                <RoundButton
                  label={isDirect ? `Fly ${name} as charted, not direct to ${fix.ident}` : `Direct to ${fix.ident}`}
                  onClick={() => onDirect(isDirect ? null : fix.ident)} aria-pressed={isDirect}
                  className={cn("mr-1", isDirect ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-tint")}
                  data-testid="fix-branch-direct"
                >
                  <MoveUpRight className="size-5" />
                </RoundButton>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
