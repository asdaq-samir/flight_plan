import { useState, type ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import { RowBadge } from "../../components/RowBadge";
import { SETTING_BADGE } from "../../lib/rowBadges";
import { useTips } from "../../lib/tips";
import { cn } from "cn";
import { ConsolePages, PageRow, StepRow } from "../../components/ConsolePages";
import DrillPage from "./DrillPage";
import HoldingPage from "./HoldingPage";
import LostCommsPage from "./LostCommsPage";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { CRUISE_REFERENCE_FT } from "../../lib/performance";
import { TEXT } from "../../lib/text";
import { altFt } from "../../lib/units";
import { scoreColor } from "../plan/format";

const BUCKETS: [string, string][] = [
  [scoreColor(4.5), "4.5 and up: you will see it and know it"],
  [scoreColor(4.0), "4 to 4.5: you should spot it without hunting"],
  [scoreColor(3.5), "3.5 to 4: findable, but easy to confuse with something nearby"],
  [scoreColor(3.0), "3 to 3.5: weak; keep a second reference"],
  [scoreColor(0), "below 3: not one to plan on"],
];

/** One tip: a short bold line and, under it, a sentence or two. */
function Tip({ title, children }: { title: string; children: ReactNode }) {
  return <ListRow title={<span className="font-semibold">{title}</span>} description={<span className={TEXT.detail}>{children}</span>} />;
}

/**
 * The guide, one page a pilot reads top to bottom, at the owner's ask
 * ("Can we make the guide a page of information and tips that's easy for
 * a pilot to read?", 2026-11-04): planning a flight in four steps, then
 * short tips under plain headings -- the sheet, the chart, the brief,
 * flying with no signal, your airplane's figures -- each a bold line and
 * a sentence or two, as iOS's Tips app reads. The longer reading that
 * was three pages of its own (the map, the phone, the airplane) is
 * folded in as tips; only the practice drills, which are tools, still
 * open pages of their own.
 */
export default function PilotGuide() {
  return (
    <ConsolePages
      back="Guide"
      pages={{
        "light-gun": { title: "Light gun signals", content: <DrillPage deck="light-gun" /> },
        "vfr-minimums": { title: "VFR weather minimums", content: <DrillPage deck="vfr-minimums" /> },
        holding: { title: "Holding entries", content: <HoldingPage /> },
        "lost-comms": { title: "Lost communications", content: <LostCommsPage /> },
      }}
    >
      <div className="space-y-6" data-testid="pilot-guide">
        <p className={cn("px-1 text-foreground", TEXT.prose)}>
          Wingtip Maps plans a VFR flight on the FAA sectional: the route, the checkpoints you will see from the
          air, the nav log and the weather for it. Here is how to get the most from it.
        </p>

        <TipsGroup />

        <ListGroup title="Plan a flight">
          <StepRow n={1} title="Type your route" description="Departure and destination on the FPL tab, by identifier or name. The course draws on the chart at once." />
          <StepRow n={2} title="Set your airplane and altitude" description="Your N-number and cruise altitude sit beside the route. Every time, fuel figure and altitude choice uses them." />
          <StepRow n={3} title="Read the brief" description="Brief opens on a verdict and at most three things to act on. Tap any of them for the why, the sources and the raw reports." />
          <StepRow n={4} title="Fly the nav log" description="Each leg's heading, time and fuel, checkpoint by checkpoint, worked in the forecast winds at your altitude." />
        </ListGroup>

        <ListGroup title="The sheet">
          <Tip title="Three sizes">Drag the sheet between a pill, half and full. A flick moves it one size, so the chart is never far away.</Tip>
          <Tip title="Four tabs">FPL is your flight, Airport any field you pick, Aircraft yours and the traffic around you, and Setup your settings, airplanes, logbook and this guide.</Tip>
          <Tip title="Close goes back">The close button at a page's top goes back one step, not all the way out.</Tip>
        </ListGroup>

        <ListGroup title="On the chart">
          <Tip title="Hold for the airspace">Hold a finger on the chart for every class of airspace over that point, its VFR minimums by day and night, and any TFR or special-use airspace there.</Tip>
          <Tip title="Tap an airport">Its weather, frequencies, runways and procedures. Fly Here makes it your destination.</Tip>
          <Tip title="The Map button">Chooses the chart (sectional, IFR low or high, the terminal area chart) and its layers, and keeps the charts on this phone for the air.</Tip>
          <Tip title="Your position">The arrow button puts you on the chart from the phone's GPS and keeps the map on you; tap it again to let go.</Tip>
        </ListGroup>

        <ListGroup title="Checkpoint colours">
          {/* A row a colour, its dot before the words, as the app's lists
              are (the developer's rating scale is the same). */}
          {BUCKETS.map(([color, label]) => (
            <ListRow
              key={label} title={label}
              media={<span className="size-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: color }} />}
            />
          ))}
        </ListGroup>

        <ListGroup title="With no signal">
          <Tip title="Open your route before you go">With signal on the ground, open your route and its brief: the app keeps the chart, the nav log, the weather and the TFRs it showed you.</Tip>
          <Tip title="Keep the charts">Turn on Keep Charts Offline in the Map button's settings, and each route's charts stay on this phone.</Tip>
          <Tip title="It stays quiet in the air">Losing coverage is normal in flight, so the app shows no errors for it and asks again by itself when the signal comes back.</Tip>
          <Tip title="Check how old it is">Setup's Status page shows whether you are online and how old each piece of weather and the TFRs are. Saved weather is not a briefing: get a fresh one when you can.</Tip>
        </ListGroup>

        <ListGroup title="Good to know">
          <Tip title="Your airplane's figures">
            Cruise speed and fuel burn start from your airplane's cruise power at {altFt(CRUISE_REFERENCE_FT)} ft on a standard
            day, then each leg flies them in the day's air at its altitude. A model within a few percent of most handbooks: yours governs.
          </Tip>
          <Tip title="A planning aid">Check everything against the current charts, NOTAMs and an official briefing before you fly.</Tip>
          <Tip title="Add it to your Home Screen">In Safari tap Share, then Add to Home Screen: it opens as its own app, the whole screen, with no browser bar over the chart.</Tip>
        </ListGroup>

        <ListGroup title="Practice">
          <PageRow page="light-gun" title="Light gun signals" description="14 CFR 91.125" />
          <PageRow page="vfr-minimums" title="VFR weather minimums" description="14 CFR 91.155" />
          <PageRow page="holding" title="Holding entries" description="AIM 5-3-8: the entry, drawn, and the wind" />
          <PageRow page="lost-comms" title="Lost communications" description="14 CFR 91.185: route, altitude, and when to leave" />
        </ListGroup>
      </div>
    </ConsolePages>
  );
}

/** The first-run tips (lib/tips), offered again from the start: the
 *  guide's short version, at its top, at the owner's ask (2026-10-27,
 *  "Tips can move to guide"), where they were a group of the Settings
 *  page. */
function TipsGroup() {
  const reset = useTips(s => s.reset);
  const [asked, setAsked] = useState(false);
  return (
    <ListGroup>
      <ListRow
        media={<RowBadge colour={SETTING_BADGE.tips}><Lightbulb /></RowBadge>}
        title={asked ? "Tips Will Show Again" : "Show Tips Again"} disabled={asked}
        onClick={() => { reset(); setAsked(true); }} data-testid="tips-reset"
      />
    </ListGroup>
  );
}
