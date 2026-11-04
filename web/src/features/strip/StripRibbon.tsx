import { useContext } from "react";
import { Plane } from "lucide-react";
import { cn } from "cn";
import CloseButton from "../../components/CloseButton";
import { TabBarMinimized, useCardTitle, useConsoleOpen } from "../../components/mapChrome";
import { closeTopCard, useOpenCards } from "../../lib/openCards";
import { useSheetCards } from "../../lib/sheetCards";
import { duration } from "../../lib/clock";
import { FINDING_TONE, type Finding } from "../../lib/status";
import { TEXT } from "../../lib/text";
import { INK, type RibbonPoint } from "./stripData";

/** The verdict's tag, as the ribbon wears it. */
const TAG: Partial<Record<Finding, { words: string; className: string }>> = {
  ok: { words: "Go", className: "bg-[color-mix(in_oklab,var(--ink-field,#1d7a46)_14%,transparent)]" },
  caution: { words: "Caution", className: "bg-caution-wash" },
  stop: { words: "No-go", className: "bg-destructive/10" },
};

/** A leg's colour on the line: flown (at past its end) grey, ahead the
 *  course's magenta, the one under the airplane grey as far as it has come. */
function legLook(leg: number, at: number | null): string {
  if (at === null || at <= leg) return INK.magenta;
  if (at >= leg + 1) return INK.flown;
  const pct = Math.round((at - leg) * 100);
  return `linear-gradient(to right, ${INK.flown} ${pct}%, ${INK.magenta} ${pct}%)`;
}

/**
 * The route's points on one line, in order: the fields' dots green, the
 * checkpoints' brown, the course's magenta line between them, each leg
 * the same width whatever its miles (a schematic, as a transit map's).
 * In the air (`position`: the leg flown, 0 on, and how far along it, 0
 * to 1) the airplane rides the line, what is flown grey behind it.
 */
export function RibbonLine({ points, position, className }: { points: RibbonPoint[]; position?: { leg: number; along: number } | null; className?: string }) {
  if (points.length < 2) return null;
  const legs = points.length - 1;
  const at = position ? Math.min(legs, Math.max(0, position.leg + Math.min(1, Math.max(0, position.along)))) : null;
  return (
    <div className={cn("relative flex w-full items-center", className)} data-testid="strip-ribbon-line" aria-hidden="true">
      {points.map((p, i) => (
        <div key={p.key} className="contents">
          <span
            className={cn("shrink-0 rounded-full", p.field ? "size-2.5" : "size-2")}
            style={{ background: at !== null && i < at ? INK.flown : p.field ? INK.field : INK.brown }}
            data-point={p.field ? "field" : "checkpoint"}
          />
          {i < legs && (
            <span
              className="h-1 min-w-1 flex-1"
              // Flown legs grey, the one under the airplane grey as far as
              // it has come, the rest the course's magenta.
              style={{ background: legLook(i, at) }}
            />
          )}
        </div>
      ))}
      {at !== null && (
        <Plane
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 fill-[var(--ink-magenta,#b3338c)] text-[var(--ink-magenta,#b3338c)]"
          style={{ left: `${(at / legs) * 100}%`, transform: "translate(-50%, -50%) rotate(45deg)" }}
          data-testid="strip-ribbon-airplane"
        />
      )}
    </div>
  );
}

/**
 * The strip's ribbon: the pill's own row, and the sheet's first row over
 * the strip (MapPanel's `bar`) -- the verdict's tag, the route's ends, its
 * time and fuel at the right, and under them the route's points on one
 * line (RibbonLine). With no route, the app's name and a word on what the
 * field takes. A card over the strip -- an airport's, the Brief, the nav
 * log -- or a screen opened from the field or the profile menu (`over`):
 * the card's name and its close in the row's place, as the tabs' bar
 * minimizes to a card's (TabBar), so the way back is where it always is.
 */
export default function StripRibbon({ dep, dest, verdict, eteMin, fuelGal, points, position, over, title: given, onClose }: {
  dep: string;
  dest: string;
  verdict: { finding: Finding; words: string } | null;
  eteMin: number | null;
  fuelGal: number | null;
  points: RibbonPoint[];
  /** The airplane's place on the line in the air (RibbonLine). */
  position?: { leg: number; along: number } | null;
  /** A screen opened over the strip from the field or the profile menu
   *  (the airplane's, a list in full): its name, for the row with its close. */
  over?: string | null;
  /** The card's own name, as the planner has it (PlanWorkspace's cardTitle). */
  title?: string;
  /** The close of whatever is over the strip: a card, a screen, a list. */
  onClose?: () => void;
}) {
  const minimized = useContext(TabBarMinimized);
  // A card's name as the tabs' bar finds it (TabBar): a card from a
  // control or the chart (SheetCard), a map card's own, the planner's.
  const cardName = useSheetCards(s => s.stack.at(-1)?.title);
  const pillName = useOpenCards(s => s.pill?.name);
  const title = useCardTitle(s => s.title);
  // Setup over the strip (MapPage's console layer): named, with its close,
  // where the tabs' bar had Setup's tab and the close (TabBar).
  const consoleOpen = useConsoleOpen(s => s.open);
  const named = minimized || over || consoleOpen;
  if (named) {
    const words = cardName ?? pillName ?? title ?? (consoleOpen ? "Setup" : null) ?? given ?? over ?? "";
    return (
      <div className="relative flex h-full w-full items-center justify-center" data-testid="strip-card-bar">
        <span className={cn("max-w-[calc(100%-7rem)] truncate font-semibold", TEXT.row)} data-testid="strip-card-title">{words}</span>
        {onClose && (
          <span className="absolute inset-y-0 right-1 flex items-center">
            <CloseButton
              label="Back"
              // Back one: a page of Setup's, a card on top; with none, Setup
              // or the card put away and the sheet down, as the tabs' close does.
              onClick={() => {
                if (closeTopCard()) return;
                if (consoleOpen) useConsoleOpen.getState().setOpen(false);
                onClose();
              }}
              data-testid="strip-card-close"
            />
          </span>
        )}
      </div>
    );
  }
  const tag = verdict ? TAG[verdict.finding] : undefined;
  const figures = [eteMin !== null ? duration(eteMin) : null, fuelGal !== null ? `${fuelGal.toFixed(1)} gal` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex h-full w-full min-w-0 flex-col justify-center gap-1.5 px-2" data-testid="strip-ribbon">
      <div className="flex min-w-0 items-center gap-2">
        {tag && verdict && (
          <span
            className={cn("shrink-0 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide", TEXT.caption, FINDING_TONE[verdict.finding], tag.className)}
            data-testid="strip-ribbon-verdict" data-finding={verdict.finding}
          >
            {tag.words}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate font-semibold", TEXT.row)} data-testid="strip-ribbon-route">
          {dest ? `${dep || "Here"} → ${dest}` : dep ? dep : "Wingtip"}
        </span>
        {figures ? (
          <span className={cn("shrink-0 tabular-nums text-muted-foreground", TEXT.detail)} data-testid="strip-ribbon-figures">{figures}</span>
        ) : !dest && (
          <span className={cn("shrink-0 text-muted-foreground", TEXT.note)}>Where to, or ask</span>
        )}
      </div>
      <RibbonLine points={points} position={position} />
    </div>
  );
}
