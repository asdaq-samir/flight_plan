import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import FindingIcon from "../../../../components/FindingIcon";
import { clockTime, duration } from "../../../../lib/clock";
import { useGlance, type FieldGlance } from "../../../../lib/glance";
import { FINDING_TONE, type Finding } from "../../../../lib/status";
import { TEXT } from "../../../../lib/text";
import { grouped } from "../../../../lib/units";
import { mhzText } from "../../../../lib/frequencies";
import { useVerdict, verdictLine } from "../../../../lib/verdict";
import type { PanelTab } from "../navlog/panelTab";
import CategoryBadge from "./CategoryBadge";

/** One figure of a card: its name over it, the figure at a glance's size. */
function Stat({ label, value, finding }: { label: string; value: ReactNode; finding?: Finding }) {
  return (
    <div className="min-w-0 flex-1">
      <div className={cn("truncate text-muted-foreground uppercase tracking-wide", TEXT.caption)}>{label}</div>
      <div className={cn("truncate font-semibold tabular-nums", TEXT.heading, finding && finding !== "ok" && FINDING_TONE[finding])}>{value}</div>
    </div>
  );
}

const DASH = "—";
/** Whom a frequency is for, in a word over it: "Campbell traffic" is the
 *  field's CTAF, "Duluth ATIS" its ATIS. */
const radioLabel = (to: string) => (/traffic$/i.test(to) ? "CTAF" : to.split(" ").at(-1) ?? to);
const ft = (n: number | null) => (n == null ? DASH : `${grouped(n)}`);
const time = (iso: string | null) => (iso ? clockTime(new Date(iso)) : null);
const MARK_TINT: Partial<Record<Finding, string>> = { stop: "bg-destructive/10", caution: "bg-caution-wash" };

/** A card: its part's name, the field and its category, its time at the
 *  right with the way in, its figures under, a line of note. The whole
 *  card is the button that opens its page. */
function Card({ tab, label, ident, category, at, finding, stats, note, onOpen }: {
  tab: PanelTab;
  label: string;
  ident?: string;
  category?: string | null;
  at?: string | null;
  finding: Finding;
  stats: ReactNode;
  note?: ReactNode;
  onOpen: (tab: PanelTab) => void;
}) {
  const marked = finding === "stop" || finding === "caution";
  return (
    <button
      type="button" onClick={() => onOpen(tab)} data-testid={`brief-glance-${tab}`} data-finding={finding}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-xl bg-card px-3.5 py-2.5 text-left shadow-[0_0_0_0.5px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        MARK_TINT[finding],
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className={cn("text-muted-foreground uppercase tracking-wide", TEXT.note)}>{label}</span>
        {ident && <span className={cn("font-bold", TEXT.row)}>{ident}</span>}
        <CategoryBadge category={category} />
        {marked && <FindingIcon finding={finding} className="size-4" />}
        <span className={cn("ml-auto font-semibold tabular-nums", TEXT.detail)}>{at}</span>
        <ChevronRight className="size-5 shrink-0 text-tint" aria-hidden />
      </span>
      <span className="flex w-full gap-2.5">{stats}</span>
      {note && <span className={cn("text-muted-foreground", TEXT.note, marked && FINDING_TONE[finding])}>{note}</span>}
    </button>
  );
}

/** A field's card: its runway, the distance over 50 ft, and its first
 *  frequency; the runway's length and the wind under. */
function FieldCard({ tab, label, field, landing, onOpen }: { tab: PanelTab; label: string; field: FieldGlance; landing: boolean; onOpen: (tab: PanelTab) => void }) {
  return (
    <Card
      tab={tab} label={label} ident={field.ident} category={field.category} at={time(field.at)} finding={field.finding} onOpen={onOpen}
      stats={(
        <>
          <Stat label="Runway" value={field.runway ?? DASH} />
          <Stat label={landing ? "Landing 50 ft" : "Takeoff 50 ft"} value={ft(field.overFiftyFt)} finding={field.finding === "stop" ? "stop" : undefined} />
          <Stat label={field.radio ? radioLabel(field.radio.to) : "Radio"} value={field.radio ? mhzText(field.radio.mhz) : DASH} />
        </>
      )}
      note={[field.runwayFt != null && `Of ${grouped(field.runwayFt)} ft`, field.wind && `wind ${field.wind}`].filter(Boolean).join(" · ") || undefined}
    />
  );
}

/**
 * The Brief as it opens, at the owner's pick of the redesign (D′,
 * 2026-10-22, "that new D looks fine for Brief"): whether to go, in a line
 * (lib/verdict), then a card for each part of the flight -- before you go,
 * the departure, en route, the arrival -- each two or three figures at a
 * glance (lib/glance), all four in one scroll, and a tap on one opens its
 * page. Stacked, not swiped: a swipe only ever goes back (the owner's
 * rule), and a pager showed one part at a time, as the tabs did.
 */
export default function BriefGlance({ onOpen }: { onOpen: (tab: PanelTab) => void }) {
  const glance = useGlance(g => g.glance);
  const items = useVerdict(v => v.items);
  const verdict = items.length ? verdictLine(items) : null;
  const before = glance?.before;
  const enroute = glance?.enroute;
  return (
    <div className="flex flex-col gap-2.5 pt-1 pb-4" data-testid="brief-glance">
      {verdict && (
        <div
          className={cn("flex items-center gap-2.5 rounded-xl px-3.5 py-2.5", MARK_TINT[verdict.finding] ?? "bg-muted")}
          role="status" data-testid="brief-verdict" data-finding={verdict.finding}
        >
          <FindingIcon finding={verdict.finding} className="size-6" />
          <span className={cn("font-semibold", TEXT.row, FINDING_TONE[verdict.finding])}>{verdict.words}</span>
        </div>
      )}
      <Card
        tab="preflight" label="Before you go" finding={before?.finding ?? "pending"} onOpen={onOpen}
        stats={(
          <>
            <Stat label="Risk" value={before?.risk ? `${before.risk.score} · ${before.risk.level === "high" ? "High" : before.risk.level === "caution" ? "Caution" : "Low"}` : DASH}
              finding={before?.risk ? ({ high: "stop", caution: "caution", low: "ok" } as const)[before.risk.level] : undefined} />
            <Stat label="Fuel spare" value={before?.spareGal != null ? `${before.spareGal.toFixed(1)} gal` : DASH} finding={before?.spareGal != null && before.spareGal < 0 ? "stop" : undefined} />
            <Stat label="W&B" value={before?.balance ? (before.balance.within ? "Within" : "Outside") : DASH} finding={before?.balance && !before.balance.within ? "stop" : undefined} />
          </>
        )}
        note={before?.balance?.problem ?? undefined}
      />
      {glance?.depart && <FieldCard tab="depart" label="Depart" field={glance.depart} landing={false} onOpen={onOpen} />}
      <Card
        tab="enroute" label="En route" finding={enroute?.finding ?? "pending"} onOpen={onOpen}
        at={enroute?.eteMin != null ? duration(enroute.eteMin) : null}
        stats={(
          <>
            <Stat label="Ceiling" value={enroute?.ceilingFt != null ? `${grouped(enroute.ceilingFt)} ft` : "None"} finding={enroute?.finding === "stop" && enroute.ceilingFt != null ? "stop" : undefined} />
            <Stat label="Visibility" value={enroute?.visibilitySm != null ? `${enroute.visibilitySm} sm` : DASH} finding={enroute?.finding === "stop" && enroute.visibilitySm != null ? "stop" : undefined} />
            <Stat label="Wind aloft" value={enroute?.wind ?? DASH} />
          </>
        )}
        note={enroute?.line ?? undefined}
      />
      {glance?.arrive && <FieldCard tab="arrive" label="Arrive" field={glance.arrive} landing onOpen={onOpen} />}
    </div>
  );
}
