import { useContext } from "react";
import { ExternalLink, Info } from "lucide-react";
import { cn } from "cn";
import FindingIcon from "../../../../components/FindingIcon";
import { useTicked, usePreflight } from "../../../../lib/preflight";
import { FINDING_TONE, type Finding } from "../../../../lib/status";
import { TEXT } from "../../../../lib/text";
import { verdictLine, type VerdictItem, type Where } from "../../../../lib/verdict";
import { GoToTab, LEGS } from "../navlog/panelTab";

/** A check the planner does not make, and where the pilot makes it: the
 *  FAA's NOTAM and flow-control feeds need an operator's credentials. */
interface Elsewhere {
  key: string;
  label: string;
  detail: string;
  /** Opened in the browser: where a pilot reads it. */
  href?: string;
  /** Or a place in the briefing. */
  at?: Where;
}

/** 14 CFR 91.103's other three, beside the Go / No-Go's seven: NOTAMs
 *  ("all available information", AIM 5-1-3), known ATC delays and the
 *  alternatives if the flight cannot be completed (91.103(a)). */
const ELSEWHERE: Elsewhere[] = [
  { key: "notams", label: "NOTAMs", detail: "Read them on 1800wxbrief.com", href: "https://www.1800wxbrief.com" },
  { key: "delays", label: "ATC delays", detail: "On fly.faa.gov", href: "https://www.fly.faa.gov" },
  { key: "alternatives", label: "Alternates", detail: "Divert from any leg", at: { tab: "enroute", section: LEGS } },
];

/**
 * Preflight's answer first, at the owner's pick of the redesign: what the
 * checks come to in a line, and every check as a tile, two to a row -- the
 * Go / No-Go's seven (lib/verdict: the weather, the airspace, the altitude,
 * the fuel, the runways, the loading and the risk) and 14 CFR 91.103's
 * other three -- each with its mark and its finding in a line, opening
 * where it is said in full: a section of the Brief (`onOpen`, for one on
 * this page, folded until then), FPL's legs, or the FAA's own page. They
 * were the Go / No-Go's rows and a 91.103 list to tick under them, the
 * same weather, fuel and runways said twice; one tile now, and a tile
 * opened is a check looked at, counted over them for this flight
 * (lib/preflight's ticks: another route or time starts again).
 */
export default function BriefChecks({ items, flight, here, onOpen }: {
  items: VerdictItem[];
  /** The flight the looks are for: its route and time. */
  flight: string;
  /** The sections of this page a tile opens, by their titles. */
  here: string[];
  /** A section of this page opened, before it is scrolled to. */
  onOpen: (section: string) => void;
}) {
  const go = useContext(GoToTab);
  const looked = useTicked(flight);
  const tick = usePreflight(s => s.tick);
  const line = verdictLine(items);
  const keys = [...items.map(i => i.key), ...ELSEWHERE.map(e => e.key)];
  const seen = keys.filter(key => looked[key]).length;
  const open = (key: string, at: Where | undefined) => {
    tick(flight, key, true);
    if (!at) return;
    if (at.section && at.tab === "preflight" && here.includes(at.section)) onOpen(at.section);
    go(at.tab, at.section);
  };
  // NOTAMs and ATC delays first after the airspace, where a pilot reads
  // them with it; the alternates last, after the risk.
  const tiles: { key: string; label: string; detail: string; finding: Finding | "elsewhere"; href?: string; at?: Where; testId: string }[] = [
    ...items.slice(0, 2).map(i => ({ ...i, at: i as Where, testId: `verdict-${i.key}` })),
    ...ELSEWHERE.slice(0, 2).map(e => ({ ...e, finding: "elsewhere" as const, testId: `check-${e.key}` })),
    ...items.slice(2).map(i => ({ ...i, at: i as Where, testId: `verdict-${i.key}` })),
    ...ELSEWHERE.slice(2).map(e => ({ ...e, finding: "elsewhere" as const, testId: `check-${e.key}` })),
  ];
  return (
    <section aria-label="Checks" className="py-3" data-testid="verdict" data-title="Go / No-Go">
      <p className={cn("flex items-start gap-2 font-semibold", FINDING_TONE[line.finding], TEXT.row)} data-testid="verdict-line" data-finding={line.finding} data-tip="verdict">
        <FindingIcon finding={line.finding} className="mt-0.5" />
        <span>{line.words}</span>
      </p>
      <p className={cn("mt-1 mb-3 pl-7 text-muted-foreground", TEXT.note)} data-testid="preflight-count">
        {seen === keys.length ? "All looked at" : `${seen} of ${keys.length} looked at`}
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {tiles.map(tile => {
          const inner = (
            <>
              <span className={cn("flex items-start gap-1.5 pr-4 font-semibold text-foreground", TEXT.prose)}>
                {tile.finding === "elsewhere"
                  ? <Info className="mt-px size-5 shrink-0 text-muted-foreground" aria-hidden />
                  : <FindingIcon finding={tile.finding} className="mt-px" />}
                <span className="min-w-0">{tile.label}</span>
              </span>
              <span className={cn("mt-1 block line-clamp-3", TEXT.note, tile.finding === "stop" ? FINDING_TONE.stop : "text-muted-foreground")}>
                {tile.detail}
              </span>
              {tile.href && <ExternalLink className="absolute top-3 right-2.5 size-4 text-tint" aria-hidden />}
              {looked[tile.key] && <span className="sr-only">, looked at</span>}
            </>
          );
          const look = cn(
            "relative block h-full min-h-[4.75rem] w-full rounded-2xl bg-card px-3 pt-2.5 pb-3 text-left outline-none",
            "shadow-[0_0_0_0.5px_rgb(0_0_0/0.06)] focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/8 pointer-coarse:active:opacity-70",
            looked[tile.key] && "bg-card/70",
          );
          return (
            <li key={tile.key}>
              {tile.href ? (
                <a
                  href={tile.href} target="_blank" rel="noreferrer" className={look} onClick={() => tick(flight, tile.key, true)}
                  data-testid={tile.testId} data-looked={looked[tile.key] || undefined}
                >
                  {inner}
                </a>
              ) : (
                <button
                  type="button" className={look} onClick={() => open(tile.key, tile.at)}
                  data-testid={tile.testId} data-finding={tile.finding === "elsewhere" ? undefined : tile.finding} data-looked={looked[tile.key] || undefined}
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
