import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import { altitudeLines, decorationOf, fixRoles, type BranchFix } from "../../../lib/procedures";
import { altFt } from "../../../lib/units";
import { TEXT } from "../../../lib/text";
import { PointFigures, PointMenu } from "./PointControls";

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
 * Its head, after the field's runways, is the procedure's name with the
 * fold's arrow beside it, turning as it opens, its kind and its fixes said
 * under it, and at its right the button to pick another (`menu`,
 * ProcedureMenu), at the owner's ask ("Arrow next to the procedure should
 * rotate and expand it. The button on the right should be to reselect
 * another approach").
 */
export default function FixBranch({ name, kind, menu, fixes, direct, crossings, onDirect, onOpen }: {
  /** The procedure, as the route's box names it ("ILS 22 · ELD"). */
  name: string;
  /** Its kind as the head says it ("Approach"), and the button to pick
   *  another of it. */
  kind: string;
  menu: ReactNode;
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
          <span className="size-2.5 rotate-45 border-2 border-white bg-procedure outline outline-1 outline-procedure" />
        </span>
        {fixes.length > 0 ? (
          <CollapsibleTrigger asChild>
            <button
              type="button" aria-label={`${name}, its fixes`} data-testid="fix-branch-toggle"
              className={cn(
                "group relative flex min-w-0 flex-1 flex-col items-start text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
              )}
            >
              <span className={cn("flex max-w-full items-center gap-1 font-semibold text-tint", TEXT.row)}>
                <span className="truncate">{name}</span>
                <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
              </span>
              <span className={cn("text-muted-foreground", TEXT.note)}>{kind}{count}</span>
            </button>
          </CollapsibleTrigger>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <span className={cn("max-w-full truncate font-semibold", TEXT.row)}>{name}</span>
            <span className={cn("text-muted-foreground", TEXT.note)}>{kind}{count}</span>
          </div>
        )}
        {menu}
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
                <span aria-hidden="true" className={cn("absolute top-0 bottom-0 left-3 border-l-2", skipped ? "border-dashed border-muted-foreground/40" : "border-procedure", i === 0 && "top-1/2", i === fixes.length - 1 && "bottom-1/2")} />
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-1/2 left-3 -translate-x-[calc(50%-1px)] -translate-y-1/2",
                    isDirect ? "size-3.5 rounded-full border-2 border-white bg-tint" : cn("size-2.5 rotate-45 border-2", skipped ? "border-muted-foreground/40 bg-background" : "border-white bg-procedure"),
                  )}
                />
                <button type="button" onClick={() => onOpen(fix.ident)} className={cn("flex min-w-0 flex-1 flex-col py-1 text-left", skipped && "opacity-50")}>
                  <span className={cn("font-semibold", TEXT.row, isDirect && "text-tint")}>{fix.ident}</span>
                  {sub && <span className={cn(TEXT.note, isDirect ? "font-semibold text-tint" : "text-muted-foreground")}>{sub}</span>}
                </button>
                <PointFigures
                  time={null} kind={own != null ? "set" : "pub"}
                  spoken={own != null ? `cross at ${altFt(own)} ft, set by you` : altitudeLines(fix).words ? `published, ${altitudeLines(fix).words}` : undefined}
                  altitude={own != null ? altFt(own) : charted ? (
                    <span style={{ textDecoration: decorationOf(charted) }}>{charted.text}</span>
                  ) : null}
                />
                <PointMenu
                  ident={fix.ident} direct={isDirect} testId="fix-branch-menu"
                  onDirect={() => onDirect(isDirect ? null : fix.ident)} onAltitude={() => onOpen(fix.ident)}
                />
                <span className="w-1 shrink-0" aria-hidden="true" />
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
