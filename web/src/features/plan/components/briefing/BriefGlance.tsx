import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GraduationCap } from "lucide-react";
import { cn } from "cn";
import FindingIcon from "../../../../components/FindingIcon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import { clockTime, duration } from "../../../../lib/clock";
import { dataWarning } from "../../../../lib/dataCycles";
import { useDataCycles } from "../../../../lib/map/layerAges";
import { glanceLines, useGlance, type FieldGlance, type GlanceLine } from "../../../../lib/glance";
import { pilotQuery, trainingQuery } from "../../../../lib/queryClient";
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
/** The verdict's wash: the Brief's one alarm. */
const MARK_TINT: Partial<Record<Finding, string>> = { stop: "bg-destructive/10", caution: "bg-caution-wash" };
const CARD = "rounded-xl bg-card shadow-[0_0_0_0.5px_var(--border)]";

/** A card: its part's name, the field and its category, its time at the
 *  right with the way in, its figures under, a line of note. The whole
 *  card is the button that opens its page. A no-go or a caution is in its
 *  icon and the figures that make it alone, the card itself plain: with
 *  the verdict, the cards and their figures all red the Brief had three
 *  reds for one finding, and the banner, the one to act on, no longer
 *  stood out (the design review, 2026-10-28, the owner's "I want all"). */
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
      className={cn("flex w-full flex-col gap-1.5 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", CARD)}
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
      {note && <span className={cn("text-muted-foreground", TEXT.note)}>{note}</span>}
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

const TRIGGER = "group flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A line a pilot acts on: the finding and what to do about it, in one
 *  sentence (lib/glance), and under a tap why it matters with the rule it
 *  rests on, the reports it was read from as sent, and the way to its
 *  page. Folded, since the owner's rule is to look and go. */
function Line({ line, onOpen }: { line: GlanceLine; onOpen: (tab: PanelTab) => void }) {
  return (
    <Collapsible className={CARD} data-testid={`brief-line-${line.key}`} data-finding={line.finding}>
      <CollapsibleTrigger className={cn(TRIGGER, TEXT.row)}>
        <FindingIcon finding={line.finding} className="mt-0.5 size-5 shrink-0" />
        <span className="min-w-0 flex-1 font-medium" data-testid="brief-line-words">{line.line}</span>
        <ChevronRight className="mt-0.5 size-5 shrink-0 text-tint transition-transform group-data-[state=open]:rotate-90" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3.5 pb-3" data-testid="brief-line-why">
        <p className={cn("rounded-lg bg-muted px-3 py-2", TEXT.detail)}>
          <span className="font-semibold">Why it matters: </span>{line.why} <span className="text-muted-foreground">({line.cite})</span>
        </p>
        {line.raw.length > 0 && (
          <div className={cn("space-y-1 px-1 font-mono whitespace-pre-wrap text-muted-foreground", TEXT.note)} data-testid="brief-line-raw">
            {line.raw.map(r => <p key={r}>{r}</p>)}
          </div>
        )}
        <button
          type="button" onClick={() => onOpen(line.tab)}
          className={cn("relative ml-1 font-semibold text-tint after:absolute after:-inset-x-2 after:-inset-y-3", TEXT.detail)}
        >
          See it in full
        </button>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One line when FAA data the plan rests on -- the airports and their
 *  frequencies, the charts, the procedures, the obstacles -- is past its
 *  cycle (the engine's data_cycle, lib/dataCycles): the plan is still
 *  made from it (warn, never limit), and a pilot should know before they
 *  go. Nothing while every edition is in force. */
function DataWarning() {
  const line = dataWarning(useDataCycles());
  if (!line) return null;
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl bg-caution-wash px-3.5 py-2.5", TEXT.detail)} role="status" data-testid="brief-data-out-of-date">
      <FindingIcon finding="caution" className="size-5 shrink-0" />
      <span className={cn("min-w-0 flex-1", FINDING_TONE.caution)}>{line}</span>
    </div>
  );
}

/** The student's instructor, where they have one (their training's
 *  accepted link): the flights put to them are what the instructor signs
 *  off from their own phone (InstructorPage). */
function InstructorNote() {
  const { data: pilot } = useQuery(pilotQuery);
  const { data: training } = useQuery({ ...trainingQuery, enabled: !!pilot });
  const link = training?.instructors.find(l => l.accepted);
  if (!link) return null;
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl bg-primary/10 px-3.5 py-2.5 text-foreground", TEXT.detail)} data-testid="brief-instructor">
      <GraduationCap className="size-5 shrink-0 text-tint" aria-hidden />
      <span>Your instructor, {link.name ?? link.email}, sees the flights you put to them and can sign off from their phone.</span>
    </div>
  );
}

/**
 * The Brief as it opens, at the owner's rule (2026-11-03, "a pilot
 * doesn't want to spend too much time in studying the briefs so make it
 * simpler for them to just look and go"): whether to go, in a line
 * (lib/verdict), then at most three one-sentence lines a pilot acts on,
 * each unfolding to why it matters and the reports behind it, the rest
 * of the findings folded into one row; then a card for each part of the
 * flight -- before you go, the departure, en route, the arrival -- each
 * two or three figures at a glance (lib/glance), a tap on one opening
 * its page. Stacked, not swiped: a swipe only ever goes back (the owner's
 * rule), and a pager showed one part at a time, as the tabs did.
 */
export default function BriefGlance({ onOpen, before: first, afterVerdict, after }: {
  onOpen: (tab: PanelTab) => void;
  /** Over the verdict, under it, and after the cards: the assistant's
   *  field, the words and the watch (BriefOverview), round the cards
   *  without moving them. */
  before?: ReactNode;
  afterVerdict?: ReactNode;
  after?: ReactNode;
}) {
  const glance = useGlance(g => g.glance);
  const items = useVerdict(v => v.items);
  const verdict = items.length ? verdictLine(items) : null;
  const lines = items.length ? glanceLines(items, glance) : null;
  const before = glance?.before;
  const enroute = glance?.enroute;
  return (
    <div className="flex flex-col gap-2.5 pt-1 pb-4" data-testid="brief-glance">
      {first}
      {verdict && (
        <div
          className={cn("flex items-center gap-2.5 rounded-xl px-3.5 py-2.5", MARK_TINT[verdict.finding] ?? "bg-muted")}
          role="status" data-testid="brief-verdict" data-finding={verdict.finding}
        >
          <FindingIcon finding={verdict.finding} className="size-6" />
          <span className={cn("font-semibold", TEXT.row, FINDING_TONE[verdict.finding])}>{verdict.words}</span>
        </div>
      )}
      {afterVerdict}
      {lines?.act.map(line => <Line key={line.key} line={line} onOpen={onOpen} />)}
      {lines && lines.rest.items.length > 0 && (
        <Collapsible className={CARD} data-testid="brief-rest" data-finding={lines.rest.finding}>
          <CollapsibleTrigger className={cn(TRIGGER, "items-center", TEXT.row)}>
            <FindingIcon finding={lines.rest.finding} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1" data-testid="brief-rest-words">{lines.rest.line}</span>
            <ChevronRight className="size-5 shrink-0 text-tint transition-transform group-data-[state=open]:rotate-90" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3.5 pb-2">
            {lines.rest.items.map(i => (
              <button
                key={i.key} type="button" onClick={() => onOpen(i.tab)} data-testid={`brief-rest-${i.key}`}
                className={cn("flex w-full items-start gap-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
              >
                <FindingIcon finding={i.finding} className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1"><span className="font-medium">{i.label}</span> · {i.detail}</span>
              </button>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
      <DataWarning />
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
      {after}
      <InstructorNote />
    </div>
  );
}
