import { useRef, useState } from "react";
import { ArrowLeftRight, Check, ChevronDown } from "lucide-react";
import { cn } from "cn";
import RoundButton from "../../../components/RoundButton";
import CloseButton from "../../../components/CloseButton";
import { GLASS_BUTTON } from "../../../components/mapChrome";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { Switch } from "../../../components/ui/switch";
import type { ProcedureList, ProcedureSummary } from "../../../lib/api/types";
import { runwayNumber } from "../../../lib/pattern";
import { usePreferences } from "../../../lib/preferences";
import { transitionWords, type PickedProcedure } from "../../../lib/procedures";
import { TEXT } from "../../../lib/text";

type Kind = ProcedureSummary["kind"];

const TITLE: Record<Kind, string> = { approach: "Approach", arrival: "Arrival", departure: "Departure" };
/** The trigger's word until one is picked, as short as it goes, at the
 *  owner's ask ("make the selections to be more compact: Arrive,
 *  Approach, Depart"). */
const SHORT: Record<Kind, string> = { approach: "Approach", arrival: "Arrive", departure: "Depart" };
const ALL: Record<Kind, string> = { approach: "All approaches…", arrival: "All arrivals…", departure: "All departures…" };
const NONE: Record<Kind, string> = { approach: "No approach", arrival: "No arrival", departure: "No departure" };

/** An approach's name in its runway's group, the runway said by the group:
 *  "ILS RWY 09L" is "ILS", "RNAV (GPS) Y RWY 10R" is "RNAV (GPS) Y". */
function shortName(p: ProcedureSummary): string {
  return p.kind === "approach" ? p.name.replace(/\s*RWY\s*\S+$/i, "") || p.name : p.name;
}

/**
 * One kind of a field's procedures picked from a pull-down, at the
 * owner's pick ("B", 2026-10-19): the trigger says the one in the route,
 * and its panel lists the field's -- an approach's by runway, the runway
 * landed on (the runway chips', preselected into the wind) first and the
 * others each a page of the menu -- each with its transitions a page of
 * its own. No approach, or none of the kind, at the foot, and the field's
 * whole list (the Procedures sheet, with each one's fixes and plate)
 * after it. The list is asked for as the menu opens.
 */
export default function ProcedureMenu({ ident, kind, list, loading, picked, label, runway, windward, fixes = [], look = "chip", onOpen, onPick, onAll }: {
  ident: string;
  kind: Kind;
  /** The field's procedures, once asked for (onOpen). */
  list: ProcedureList | undefined;
  loading: boolean;
  /** The one of the kind in the route, and its name as the route's box
   *  says it. */
  picked: PickedProcedure | null;
  label: string | null;
  /** The runway landed on and the one into the wind, in a chip's form
   *  ("9L"): an approach's group first. */
  runway: string | null;
  windward: string | null;
  /** The picked one's fixes ATC can send the airplane direct to, in its
   *  order (its drawing's): with any, a page of them. */
  fixes?: string[];
  /** Its trigger: a chip; a round button at the right of the procedure's
   *  branch, to pick another (FixBranch, at the owner's ask: "the button on
   *  the right should be to reselect another approach"); or, none picked,
   *  "+ Arrival" in a dashed outline, after the field's runways (the
   *  owner's pick, option C). */
  look?: "chip" | "button" | "add";
  onOpen: () => void;
  onPick: (next: { id: string; transition: string | null; direct?: string | null } | null) => void;
  onAll: () => void;
}) {
  const all = (list?.procedures ?? []).filter(p => p.kind === kind);
  const plates = usePreferences(s => s.plates);
  // A runway's approaches and a procedure's transitions are pages pushed
  // in the panel's place, Back at the head's left to the one before.
  const [pages, setPages] = useState<Page[]>([]);
  const [open, setOpen] = useState(false);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) onOpen(); else setPages([]);
  };
  // The whole list opens a sheet of its own: focus not handed back to the
  // trigger as this closes, which the sheet took for a tap outside it
  // and closed (the desktop's popover).
  const toSheet = useRef(false);
  const page = pages.at(-1) ?? null;
  const push = (next: Page) => setPages([...pages, next]);
  const pick = (next: { id: string; transition: string | null; direct?: string | null } | null) => { onPick(next); toggle(false); };
  const runwayName = (r: string) => (r === "Circling" ? "Circling" : `Runway ${r}${r === windward ? " · into the wind" : ""}`);
  const item = (p: ProcedureSummary, name: string) => {
    const on = picked?.id === p.id;
    // Its transitions a page where it has any; else picked at a tap.
    return (
      <ListRow
        key={p.id} title={name} value={<Mark on={on} />} aria-pressed={on} chevron={p.transitions.length > 0}
        onClick={() => (p.transitions.length > 0 ? push({ procedure: p, name }) : pick({ id: p.id, transition: null }))}
        data-testid="procedure-menu-item"
      />
    );
  };
  // An approach's by runway: the runway landed on first, open; the rest a
  // page each, in the runways' order; one circling only under Circling.
  const byRunway = new Map<string, ProcedureSummary[]>();
  for (const p of all) {
    const key = p.runway ? runwayNumber(p.runway) : "Circling";
    byRunway.set(key, [...(byRunway.get(key) ?? []), p]);
  }
  const first = kind === "approach"
    ? [runway, windward, ...byRunway.keys()].find(r => r !== null && byRunway.has(r)) ?? null : null;
  const others = [...byRunway.keys()].filter(r => r !== first).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const title = page && "procedure" in page ? page.procedure.name : page && "direct" in page ? "Direct to" : page ? runwayName(page.runway)
    : `${ident} ${TITLE[kind].toLowerCase()}`;
  return (
    // Expanded as everything in the app is, at the owner's ask ("whenever
    // anything is expanded it should open with the title on top with a
    // back button on the left and close button on the right"): its title
    // on top, Back on the left once a page is pushed, the close on the
    // right; a fixed height, its list scrolling in it. On a phone a sheet
    // (ResponsivePopover), beside the trigger from md up.
    <ResponsivePopover open={open} onOpenChange={toggle}>
      <ResponsivePopoverTrigger asChild>
        {/* One line, at the owner's ask: the kind's name ("Approach") until
            one is picked ("Just remove the word select"), then the one
            picked, its words black as every glass button's are (the owner's
            D1, 2026-10-23: no tint on the glass). A chip's size beside the
            field's ident in its head, its 44-point area a pseudo-element
            round it (the owner's compact head). Opened by a tap -- its
            lift, as a button's click is -- not a touch. */}
        {look === "button" ? (
          // The one picked's name kept in it for a reader, unseen: the
          // branch's head shows it.
          <RoundButton
            label={`${ident} ${TITLE[kind].toLowerCase()}: ${label ?? "none picked"}, pick another`}
            data-testid="procedure-kind" data-kind={kind} data-look={look}
          >
            <ArrowLeftRight className="size-5" strokeWidth={2} />
            <span className="sr-only">{label ?? SHORT[kind]}</span>
          </RoundButton>
        ) : (
          <button
            type="button" data-testid="procedure-kind" data-kind={kind} data-look={look}
            className={cn(
              "relative flex min-w-0 shrink items-center gap-0.5 text-left font-semibold outline-none",
              "after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring",
              // The buttons' glass, a kind to add as one picked, at the
              // owner's pick of the sketches ("B"): it was a dashed outline.
              GLASS_BUTTON,
              look === "add" ? cn("h-8 rounded-full px-3", TEXT.detail)
                : cn("h-8 max-w-[10rem] rounded-full px-2.5", TEXT.detail),
            )}
            aria-label={`${ident} ${TITLE[kind].toLowerCase()}: ${label ?? "none picked"}`}
          >
            {look === "add" ? <span className="truncate">+ {TITLE[kind]}</span> : <span className="truncate">{label ?? SHORT[kind]}</span>}
            {look !== "add" && <ChevronDown className="size-4 shrink-0" aria-hidden />}
          </button>
        )}
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title={title} align="start" side="bottom"
        className="flex h-[26rem] w-80 flex-col gap-3 overflow-y-auto p-3"
        sheetClassName="data-[side=bottom]:h-[60dvh] data-[side=top]:h-[60dvh]"
        // The map above it in sight and clear, no shade or blur over it, as
        // the Procedures sheet keeps it (the owner's screenshot: blurred).
        sheetOverlayClassName="bg-transparent dark:bg-transparent supports-backdrop-filter:backdrop-blur-none"
        // No Back: the close goes back a page where one is pushed, at the
        // owner's ask ("remove the back buttons, because close button should
        // behave as the back button", 2026-10-22).
        action={<CloseButton label={page ? "Back" : "Close"} onClick={() => (page ? setPages(pages.slice(0, -1)) : toggle(false))} data-testid="procedure-menu-close" />}
        data-testid="procedure-menu"
        onCloseAutoFocus={event => { if (toSheet.current) event.preventDefault(); toSheet.current = false; }}
      >
        {page && "procedure" in page ? (
          <ListGroup>
            {[null, ...page.procedure.transitions].map(t => {
              const on = picked?.id === page.procedure.id && (picked.transition ?? null) === t;
              return (
                <ListRow
                  key={t ?? "-"} title={transitionWords(kind, t)} value={<Mark on={on} />} aria-pressed={on}
                  onClick={() => pick({ id: page.procedure.id, transition: t })} data-testid="procedure-menu-transition"
                />
              );
            })}
          </ListGroup>
        ) : page && "direct" in page && picked ? (
          // A fix ATC sent the airplane to, at the owner's ask ("the ability
          // to go direct to a fix as told by ATC"): the procedure flown from
          // there, straight to it (vfr.procedure_paths), or as charted.
          <ListGroup>
            {[null, ...fixes].map(f => {
              const on = (picked.direct ?? null) === f;
              return (
                <ListRow
                  key={f ?? "-"} title={f ?? "As charted"} value={<Mark on={on} />} aria-pressed={on}
                  onClick={() => pick({ id: picked.id, transition: picked.transition, direct: f })} data-testid="procedure-menu-direct-fix"
                />
              );
            })}
          </ListGroup>
        ) : page && "runway" in page ? (
          <ListGroup>{(byRunway.get(page.runway) ?? []).map(p => item(p, shortName(p)))}</ListGroup>
        ) : (
          <>
            {all.length === 0 && (
              <p role="status" className={cn("px-1 text-muted-foreground", TEXT.detail)}>{loading ? "Fetching them…" : "None published"}</p>
            )}
            {kind === "approach" && first !== null && (
              <>
                <ListGroup title={runwayName(first)}>{byRunway.get(first)!.map(p => item(p, shortName(p)))}</ListGroup>
                {others.length > 0 && (
                  <ListGroup title="Other runways">
                    {others.map(r => (
                      <ListRow
                        key={r} title={runwayName(r)} chevron value={<Mark on={byRunway.get(r)!.some(p => p.id === picked?.id)} />}
                        onClick={() => push({ runway: r })} data-testid="procedure-menu-runway"
                      />
                    ))}
                  </ListGroup>
                )}
              </>
            )}
            {kind !== "approach" && all.length > 0 && <ListGroup>{all.map(p => item(p, p.name))}</ListGroup>}
            {picked && fixes.length > 0 && (
              <ListGroup>
                <ListRow
                  title="Direct to" value={picked.direct ?? "As charted"} chevron
                  onClick={() => push({ direct: true })} data-testid="procedure-menu-direct"
                />
              </ListGroup>
            )}
            <ListGroup>
              {/* The plate on the chart or not, at the owner's ask. */}
              {kind === "approach" && picked && (
                <ListRow title="Plate on the map">
                  <Switch checked={plates} onCheckedChange={on => usePreferences.getState().setPlates(on)} aria-label="Plate on the map" data-testid="procedure-menu-plate" />
                </ListRow>
              )}
              {picked && <ListRow title={NONE[kind]} onClick={() => pick(null)} data-testid="procedure-menu-none" />}
              <ListRow title={ALL[kind]} chevron onClick={() => { toSheet.current = true; toggle(false); onAll(); }} data-testid="procedure-menu-all" />
            </ListGroup>
          </>
        )}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/** A page of the panel pushed in its place: a runway's approaches, or a
 *  procedure's transitions. */
type Page = { runway: string } | { procedure: ProcedureSummary; name: string } | { direct: true };

/** The one picked, ticked at the row's end, as an iOS list's choice is;
 *  nothing on the others, so no row is set in for it (the owner's
 *  screenshot: every row stood in by an empty mark's room). */
function Mark({ on }: { on: boolean }) {
  return on ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null;
}
