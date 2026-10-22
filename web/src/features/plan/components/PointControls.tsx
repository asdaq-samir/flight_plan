import type { ReactNode } from "react";
import { ArrowUp, Crosshair, Ellipsis, Info, Mountain, MoveUpRight, MoveVertical, Pencil, Repeat2, Trash2 } from "lucide-react";
import { cn } from "cn";
import { GLASS_BUTTON } from "../../../components/mapChrome";
import RoundButton from "../../../components/RoundButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { DROPDOWN, useAfterMenu, type MenuKit } from "./pointMenu";
import { TEXT } from "../../../lib/text";

/** What a point's altitude is: a field's elevation, the plan's cruise to
 *  it, the chart's crossing at a procedure's fix, or the pilot's own. */
export type AltitudeKind = "elev" | "cruise" | "pub" | "set";

/**
 * The end of a point's row in FPL's list, at the owner's pick (A of the
 * canvas's rows, 2026-10-20: "keep the format of altitude
 * (elev/published/cruising) and eta to the right side of each
 * depart/arrive and waypoints"): its time over its altitude, the
 * altitude's kind after it, small; the pilot's own in the tint.
 */
export function PointFigures({ time, altitude, kind, spoken, testId = "point-figures" }: {
  /** Its time, or the picker for it where the airplane leaves. */
  time: ReactNode;
  /** The altitude, or the chart's crossing as it is drawn; none known, none. */
  altitude: ReactNode;
  kind: AltitudeKind;
  /** The altitude as a screen reader says it, where the drawing says more
   *  than its figure ("at or above 2,000 ft", a line under it): else the
   *  figure in feet and its kind in words. */
  spoken?: string;
  /** Its own name where an airport's block sets its time and its
   *  elevation on lines of their own (ProceduresRoute's block). */
  testId?: string;
}) {
  return (
    <span className={cn("flex shrink-0 flex-col items-end tabular-nums leading-tight", TEXT.detail)} data-testid={testId}>
      {typeof time === "string" ? <span className="font-semibold">{time}</span> : time}
      {altitude != null && (
        <span className={kind === "set" ? "font-semibold text-tint" : "text-muted-foreground"} data-testid="point-altitude-figure" data-kind={kind}>
          {/* "pub", "elev" and a line over or under a figure are for the
              eye; VoiceOver says them in words (the audit's finding). */}
          {/* The field's elevation with the mountain, an altitude flown or
              set with the arrow up, at the owner's ask ("Elevation can have
              an icon like wind does"). */}
          <span aria-hidden="true" className="inline-flex items-center gap-0.5">
            {kind === "elev" ? <Mountain className="size-3.5 shrink-0" /> : <ArrowUp className="size-3.5 shrink-0" />}{altitude} ft
          </span>
          <span className="sr-only">{spoken ?? (typeof altitude === "string" ? `${altitude} ft, ${KIND_WORDS[kind]}` : KIND_WORDS[kind])}</span>
        </span>
      )}
    </span>
  );
}

/** Each altitude's kind said in words. */
const KIND_WORDS: Record<AltitudeKind, string> = {
  elev: "field elevation", cruise: "planned cruise", pub: "published", set: "set by you",
};

/** What can be done at a point of the route, each there only where the
 *  point has it: the same items in FPL's "⋯" (PointMenu) and the route
 *  box's pill (RouteBox), in the same words and order, at the audit's
 *  finding (two menus for one point, in different words). */
export interface PointActions {
  ident: string;
  /** Another point in its place (the route box's search). */
  onChange?: () => void;
  /** Flown direct to now: its item flies the route as planned again. */
  direct?: boolean;
  onDirect?: () => void;
  onAltitude?: () => void;
  /** The altitude set there now, after Set altitude…, with a caution
   *  where the planner has one for it. */
  altitude?: ReactNode;
  /** The pilot's own point off this one (FixFromDialog). */
  onFix?: () => void;
  /** A hold there (HoldSheet); `held`, one is set already. */
  onHold?: () => void;
  held?: boolean;
  onInfo?: () => void;
  onRemove?: () => void;
}

/** The point's items, in one order and one set of words, for either menu. */
export function PointMenuItems({ actions: a, kit, later, testId }: {
  actions: PointActions; kit: MenuKit; later: ReturnType<typeof useAfterMenu>["later"]; testId: string;
}) {
  const { Item, Label, Separator, Shortcut } = kit;
  return (
    <>
      <Label>{a.ident}</Label>
      {a.onChange && <Item onSelect={later(a.onChange, true)} data-testid={`${testId}-change`}><Pencil aria-hidden="true" />Change</Item>}
      {a.onDirect && (
        <Item onSelect={a.onDirect} data-testid={`${testId}-direct`}>
          <MoveUpRight aria-hidden="true" />{a.direct ? "Fly as planned" : "Direct to"}
        </Item>
      )}
      {a.onAltitude && (
        <Item onSelect={later(a.onAltitude)} data-testid={`${testId}-altitude`}>
          <MoveVertical aria-hidden="true" />Set altitude…
          {a.altitude != null && <Shortcut className="flex items-center gap-1 tracking-normal tabular-nums">{a.altitude}</Shortcut>}
        </Item>
      )}
      {a.onFix && <Item onSelect={later(a.onFix)} data-testid={`${testId}-fix`}><Crosshair aria-hidden="true" />Create a fix from here…</Item>}
      {a.onHold && (
        <Item onSelect={later(a.onHold)} data-testid={`${testId}-hold`}>
          <Repeat2 aria-hidden="true" />{a.held ? "Change hold…" : "Hold here…"}
        </Item>
      )}
      {a.onInfo && <Item onSelect={later(a.onInfo)} data-testid={`${testId}-info`}><Info aria-hidden="true" />More info</Item>}
      {a.onRemove && (
        <>
          <Separator />
          {/* The one word, at the pilot's ask of the pill's menu. */}
          <Item variant="destructive" onSelect={a.onRemove} data-testid={`${testId}-remove`}><Trash2 aria-hidden="true" />Remove</Item>
        </>
      )}
    </>
  );
}

/**
 * A point's menu, at the owner's ask ("Each stop can have a menu (set
 * altitude, create a fix, hold here, More Info)", "And the menu can
 * include direct to"): shadcn's DropdownMenu, its items the route box's
 * pill's (PointMenuItems). Behind the point's own mark in FPL's list
 * (`face`), at the owner's ask ("Use the airport icon as the more button
 * instead of having one to the right", 2026-10-22): the mark a button,
 * its 44 points a pseudo-element round its 28; else the "⋯" (RoundButton,
 * 36 with a 20-point glyph, as every icon button is).
 */
export function PointMenu({ testId = "point-menu", face, ...actions }: PointActions & { testId?: string; face?: ReactNode }) {
  const { later, onCloseAutoFocus } = useAfterMenu();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {face ? (
          <button
            type="button" aria-label={`${actions.ident}: more`} data-testid={testId} data-point-mark=""
            // A round glass button round the symbol, as the app's other
            // buttons are, so it reads as one, at the owner's pick (option A,
            // 2026-10-22: "make the airport icons actually look like
            // selectable buttons"): 32 round its 24, its 44 a pseudo-element,
            // centred on the route's line as the bare symbol was.
            className={cn("relative -mx-0.5 -mt-0.5 grid size-8 shrink-0 place-items-center rounded-full outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", GLASS_BUTTON)}
          >
            {face}
          </button>
        ) : (
          <RoundButton label={`${actions.ident}: more`} className="shrink-0 text-tint" data-testid={testId}>
            <Ellipsis className="size-5" aria-hidden="true" />
          </RoundButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={face ? "start" : "end"} className="min-w-56" onCloseAutoFocus={onCloseAutoFocus}>
        <PointMenuItems actions={actions} kit={DROPDOWN} later={later} testId={testId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
