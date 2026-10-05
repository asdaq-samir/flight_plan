import type { ReactNode } from "react";
import { Download, Layers, Maximize, Navigation, Settings } from "lucide-react";
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

/** A page's reading: the text's own colour at a paragraph's size. */
function Reading({ children }: { children: ReactNode }) {
  return <div className={cn("space-y-3", TEXT.prose)}>{children}</div>;
}

/**
 * The planner explained to the pilot, the pilot console's Guide tab, as
 * iOS lays out a page of Settings: what to do, in five numbered steps
 * (the last points to Print beside the route, NavLogActions, and to
 * keeping the charts for the air, a setting); what the checkpoints'
 * colours mean; the longer reading -- how the nav log flies the
 * aeroplane, the map's buttons, the app on a phone -- a row each that
 * opens a page of its own (ConsolePages). It was a column of headings over
 * paragraphs, a screen and a half of reading on a phone before the
 * colours, and still told the pilot about the header and its drawer
 * after both had gone.
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
        aeroplane: {
          title: "Your aeroplane in the day's air",
          content: (
            <Reading>
              <p>
                Your aeroplane's cruise speed and fuel burn are taken as its figures at its cruise power
                at {altFt(CRUISE_REFERENCE_FT)} ft on a standard day, a row of its handbook's cruise table.
              </p>
              <p>
                Each leg flies them in the forecast air at its altitude, as a density altitude: faster in thinner
                air at the same power, and slower and thriftier where full throttle can no longer make it. Climbs
                slow as the air thins, and a warm day lowers the service ceiling.
              </p>
              <p>
                The nav log gives each leg's TAS, and the altitude's reasoning the rest. A model, within a few
                percent of most handbooks: yours governs.
              </p>
            </Reading>
          ),
        },
        map: {
          title: "The map and its buttons",
          content: (
            <>
              <Reading>
                <p>The chart is the FAA sectional, the whole country, at every zoom, and the route panel sits over it.</p>
                <p>
                  Hold a finger on the chart, or right-click it, for the airspace over that point: each class from the
                  ground up, its VFR minimums by day and night, what it takes to go in and what to carry, and any
                  special-use airspace or TFR there.
                </p>
              </Reading>
              <ListGroup title="The map's buttons">
                <ListRow media={<Settings className="size-5 text-tint" />} title="Settings" description="This, beside the search bar: the guide, your aircraft and flights, and the settings. Close a route to reach it" />
                <ListRow media={<Navigation className="size-5 text-tint" />} title="My position" description="Where you are, from the phone's GPS, the map brought in close and kept on you; again to hide it" />
                <ListRow media={<Maximize className="size-5 text-tint" />} title="Full screen" description="Where your browser allows it" />
              </ListGroup>
              <ListGroup title="In the settings" footer="Close in over a terminal area and a pin on the map pins that sheet.">
                <ListRow media={<Layers className="size-5 text-tint" />} title="Charts" description="Sectional, IFR low or IFR high, the terminal area chart over it, and the Class B airports" />
                <ListRow media={<Download className="size-5 text-tint" />} title="Offline" description="Keep each route's charts on this device for the air" />
              </ListGroup>
            </>
          ),
        },
        phone: {
          title: "On your phone",
          content: (
            <Reading>
              <p>
                Add this to your Home Screen and it opens as its own app: the whole screen, with no browser bar over
                the chart, and the charts you keep stay kept. In Safari tap Share, then Add to Home Screen.
              </p>
              <p>In a browser tab the address bar stays put, because the page holds still under your finger rather than scrolling.</p>
            </Reading>
          ),
        },
      }}
    >
      <div className="space-y-6">
        <ListGroup title="Plan a flight">
          <StepRow n={1} title="Choose your route" description="Departure and destination at the top of the panel, then the arrow. The course draws at once." />
          <StepRow n={2} title="Find your checkpoints" description="The numbered dots are landmarks you can pick out from the air. Tap one for how to spot it, and add your own note." />
          <StepRow n={3} title="Read the nav log" description="Pull the panel up: each leg's heading, time and fuel, then the weather, NOTAMs and airports. Your aircraft and departure time are under the route." />
          <StepRow n={4} title="Look at an airport" description="Close in and tap one on the chart for its weather, radio and runways. Fly Here makes it your destination." />
          <StepRow n={5} title="Take it with you" description="Print, beside the route, for the nav log on paper; and Offline in the settings keeps each route's charts on this device for the air." />
        </ListGroup>

        <ListGroup title="Checkpoint colours" footer="Each checkpoint is rated for how findable it is from the cockpit, 0 to 5.">
          {/* A row a colour, its dot before the words, as the app's lists
              are (the developer's rating scale is the same). */}
          {BUCKETS.map(([color, label]) => (
            <ListRow
              key={label} title={label}
              media={<span className="size-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: color }} />}
            />
          ))}
        </ListGroup>

        <ListGroup title="Practice" footer="Cards to go through until you know them, kept in this browser; and two of the instrument rating's, worked out.">
          <PageRow page="light-gun" title="Light gun signals" description="14 CFR 91.125" />
          <PageRow page="vfr-minimums" title="VFR weather minimums" description="14 CFR 91.155" />
          <PageRow page="holding" title="Holding entries" description="AIM 5-3-8: the entry, drawn, and the wind" />
          <PageRow page="lost-comms" title="Lost communications" description="14 CFR 91.185: route, altitude, and when to leave" />
        </ListGroup>

        <ListGroup title="More">
          <PageRow page="aeroplane" title="Your aeroplane in the day's air" />
          <PageRow page="map" title="The map and its buttons" />
          <PageRow page="phone" title="On your phone" />
        </ListGroup>
      </div>
    </ConsolePages>
  );
}
