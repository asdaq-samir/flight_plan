import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Hand, LifeBuoy } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "./GroupedList";
import { RowBadge } from "./RowBadge";
import { DATA_SOURCES, PLANNING_AID } from "../lib/limits";
import { LEGAL_PAGES } from "../lib/legal";
import { nativeAppVersion } from "../lib/native";
import { chartQuery } from "../lib/queryClient";
import { SETTING_BADGE } from "../lib/rowBadges";
import { versionOf } from "../lib/speed";
import { TEXT } from "../lib/text";

/** "09-03-2026", the chart server's cycle, as "3 Sep 2026". */
function editionOf(cycle: string): string {
  const [month, day, year] = cycle.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return Number.isNaN(date.getTime()) ? cycle : format(date, "d MMM yyyy");
}

const LEGAL_GLYPHS: Record<(typeof LEGAL_PAGES)[number]["key"], ReactNode> = {
  privacy: <Hand />, terms: <FileText />, support: <LifeBuoy />,
};

/**
 * The console's About tab, after Settings, at the owner's ask ("Design an
 * about tab in settings and you can move the planning aid paragraph
 * there"), laid out as iOS's Settings > General > About: the app's mark
 * and name over a group of what it is -- its version and build, the
 * chart's edition -- then the planning aid's words, which were the nav
 * log's footer, where the data comes from, each with the terms it is used
 * under, and the privacy policy, terms and support (lib/legal), which App
 * Review wants inside the app. It was a row of Settings ("About &
 * limits") that opened a sheet, and the legal pages' group under it.
 */
export default function AboutPanel() {
  const { data: chart } = useQuery(chartQuery);
  const [app, setApp] = useState<{ version: string; build: string } | null>(null);
  useEffect(() => {
    let live = true;
    void nativeAppVersion().then(v => { if (live) setApp(v); }).catch(() => {});
    return () => { live = false; };
  }, []);
  // The web's build is the entry chunk's hash, as the speed reports name
  // it (lib/speed): one build, one name, and "dev" under vite's server.
  const build = versionOf(document);
  return (
    <div className="space-y-5 pb-1" data-testid="about-panel">
      <header className="flex flex-col items-center gap-2 pt-2 text-center">
        <img src="/app/icon-192.png" alt="" className="size-16 rounded-[22%] shadow-sm" />
        <h2 className={cn("font-bold text-foreground", TEXT.card)}>Wingtip Maps</h2>
        <p className={cn("text-foreground", TEXT.detail)}>VFR flight planning on the FAA chart</p>
      </header>

      <ListGroup>
        {app && <ListRow title="Version" value={`${app.version} (${app.build})`} data-testid="about-version" />}
        <ListRow title={app ? "Web build" : "Build"} value={build} data-testid="about-build" />
        <ListRow title="Chart edition" value={chart ? editionOf(chart.chart_cycle) : "—"} data-testid="about-chart-edition" />
      </ListGroup>

      {/* What the planner is not, in full: it was the nav log's footer. */}
      <ListGroup title="A planning aid">
        <ListRow title={<span className={TEXT.detail} data-testid="about-planning-aid">{PLANNING_AID}</span>} />
      </ListGroup>

      <ListGroup
        title="Data sources"
        footer="Checkpoints are found on the FAA sectional itself and ranked by the planner's own chart model. The FAA's, NOAA's and the USGS's data are works of the US government, which carry no copyright."
      >
        {DATA_SOURCES.map(s => (
          <ListRow key={s.name} title={s.name} value={s.licence} href={s.href} data-testid="about-source" />
        ))}
      </ListGroup>

      <ListGroup title="Legal">
        {LEGAL_PAGES.map(p => (
          <ListRow
            key={p.key} media={<RowBadge colour={SETTING_BADGE.about}>{LEGAL_GLYPHS[p.key]}</RowBadge>}
            title={p.title} href={p.href} data-testid={`legal-${p.key}`}
          />
        ))}
      </ListGroup>
    </div>
  );
}
