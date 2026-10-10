import { Bell, BellOff, CloudSun, Download, Eye, EyeOff, Map as MapIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented from "./Segmented";
import TogglePill from "./TogglePill";
import { keepingAvailable } from "../lib/map/keepRoute";
import { BASE_CHARTS, usePreferences, type BaseChart } from "../lib/preferences";
import { chartQuery } from "../lib/queryClient";

/** "09-03-2026", the FAA's cycle as the chart server names it, as "3 Sep
 *  2026"; the cycle as it is where it reads otherwise. */
function editionOf(cycle: string): string {
  const [month, day, year] = cycle.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  return Number.isNaN(date.getTime()) ? cycle : format(date, "d MMM yyyy");
}

/**
 * The map's settings, the whole of the map's own button's sheet
 * (MapSettingsButton), as Maps' map button holds its map's -- moved out
 * of the console's Settings at the pilot's ask: the chart, Class B's
 * weather and terminal sheet, the waypoints, the TFRs, the alerts in
 * flight, and keeping charts offline, with the charts' edition under them.
 */
export default function MapSettings() {
  const base = usePreferences(s => s.base);
  const tac = usePreferences(s => s.tac);
  const classB = usePreferences(s => s.classB);
  const setBase = usePreferences(s => s.setBase);
  const setTac = usePreferences(s => s.setTac);
  const setClassB = usePreferences(s => s.setClassB);
  const tfrs = usePreferences(s => s.tfrs);
  const setTfrs = usePreferences(s => s.setTfrs);
  const alerts = usePreferences(s => s.alerts);
  const setAlerts = usePreferences(s => s.setAlerts);
  const military = usePreferences(s => s.military);
  const setMilitary = usePreferences(s => s.setMilitary);
  const waypoints = usePreferences(s => s.waypoints);
  const setWaypoints = usePreferences(s => s.setWaypoints);
  const keepOffline = usePreferences(s => s.keepOffline);
  const setKeepOffline = usePreferences(s => s.setKeepOffline);
  const available = keepingAvailable();
  // Where the charts come from and which edition is up, under the map's
  // settings: it was a credit in the chart's corner, which the FAA's
  // charts, a US government work, do not ask for. The edition is what a
  // pilot checks: a chart is current for its cycle.
  const { data: chart } = useQuery(chartQuery);
  return (
    <ListGroup
      title="Map"
      footer={chart ? `Charts from the FAA, the ${editionOf(chart.chart_cycle)} edition.` : "Charts from the FAA."}
    >
      <ListRow title="Chart">
        <Segmented
          label="Chart" value={base} onChange={v => setBase(v as BaseChart)} testId="base-chart-select"
          options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label }))}
        />
      </ListRow>
      {/* The Class B airports' two things, on one line: their weather
          now, as chips on the map, and the terminal sheet over the base
          wherever there is one -- the TAC over the sectional, the IFR
          area chart over the IFR charts. Each on or off by itself; they
          were two rows of switches. A chip's card pins its field's
          sheet either way. */}
      <ListRow title="Class B">
        <div className="flex gap-2" role="group" aria-label="Class B">
          <TogglePill pressed={classB} onPressedChange={setClassB} icon={<CloudSun />} label="Weather" testId="class-b-toggle" />
          {/* TAC, as pilots call the sectional's terminal area chart; its
              IFR counterpart is the area chart. */}
          <TogglePill pressed={tac} onPressedChange={setTac} icon={<MapIcon />} label={base === "sec" ? "TAC" : "Area"} testId="tac-toggle" />
        </div>
      </ListRow>
      {/* The route's waypoints, on either map: the planner's numbered
          checkpoints at every zoom and the dim landmarks they were chosen
          from closer in, the training map's detections; off, the course
          line and its two airports alone. */}
      <ListRow title="Waypoints">
        <TogglePill pressed={waypoints} onPressedChange={setWaypoints} icon={waypoints ? <Eye /> : <EyeOff />} label="Show" testId="waypoints-toggle" />
      </ListRow>
      {/* The temporary flight restrictions, from tfr.faa.gov: on unless
          turned off, as a pilot must know of every one near the route. */}
      <ListRow title="TFRs">
        <TogglePill pressed={tfrs} onPressedChange={setTfrs} icon={tfrs ? <Eye /> : <EyeOff />} label="Show" testId="tfrs-toggle" />
      </ListRow>
      {/* What is ahead of own ship in the air, over the map (AlertsBanner):
          on unless turned off. */}
      <ListRow title="Alerts">
        <TogglePill pressed={alerts} onPressedChange={setAlerts} icon={alerts ? <Bell /> : <BellOff />} label="In flight" testId="alerts-toggle" />
      </ListRow>
      {/* The fields the armed services own and keep to themselves, at the
          pilot's ask: off by default, as most pilots may not land there
          without the service's permission. A joint-use field, a civil
          airport on a military one, is drawn either way. */}
      <ListRow title="Military">
        <TogglePill pressed={military} onPressedChange={setMilitary} icon={military ? <Eye /> : <EyeOff />} label="Show" testId="military-toggle" />
      </ListRow>
      {/* The base chart along each route loaded, held for the air
          (useKeepOffline); how a keep goes is its toast. Over plain http
          there is no service worker to hold it, and it cannot be on. */}
      <ListRow title="Offline">
        <TogglePill
          pressed={keepOffline && available} onPressedChange={setKeepOffline} disabled={!available}
          icon={<Download />} label="Keep charts" testId="keep-offline-toggle"
        />
      </ListRow>
    </ListGroup>
  );
}
