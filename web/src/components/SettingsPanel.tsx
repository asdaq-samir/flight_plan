import { useId, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ListGroup, ListRow } from "./GroupedList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { useDevMode } from "../hooks/use-dev-mode";
import { useNavEdge } from "../hooks/use-nav-edge";
import { ownShipAvailable, useOwnShip } from "../lib/map/ownShip";
import { BASE_CHARTS, MARKER_ZOOMS, usePreferences, type BaseChart, type NavEdge } from "../lib/preferences";

/** What a page adds to the settings: the planner's every-landmark switch
 *  and own ship. The training page adds nothing. */
export interface PageSettings {
  candidates?: { on: boolean; onToggle: (on: boolean) => void };
  ownShip?: boolean;
}

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end, and at most a line of help. A
 * switch for anything on or off, a segmented control for two or three
 * choices, all on show and one tap each, and a menu only for the
 * four-way one. Dev mode first, for whoever it is for; then the map,
 * what is changed most while planning; the checkpoints, appearance,
 * and the pilot's own position. Everything here is remembered per
 * browser.
 *
 * It replaced a column of headings, checkboxes, dropdowns and a
 * paragraph under nearly every control, twice the height, where a
 * two-way choice took two taps in a menu.
 */
export default function SettingsPanel({ page }: { page?: PageSettings }) {
  return (
    <div className="space-y-5 pb-1" data-testid="settings-panel">
      <DeveloperGroup />
      <MapGroup />
      <CheckpointsGroup candidates={page?.candidates} />
      <AppearanceGroup />
      {page?.ownShip && <PositionGroup />}
    </div>
  );
}

function MapGroup() {
  const base = usePreferences(s => s.base);
  const tac = usePreferences(s => s.tac);
  const classB = usePreferences(s => s.classB);
  const setBase = usePreferences(s => s.setBase);
  const setTac = usePreferences(s => s.setTac);
  const setClassB = usePreferences(s => s.setClassB);
  const tacId = useId();
  const classBId = useId();
  return (
    <ListGroup title="Map">
      <ListRow title="Chart">
        <Segmented
          label="Chart" value={base} onChange={v => setBase(v as BaseChart)} testId="base-chart-select"
          options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label }))}
        />
      </ListRow>
      {/* The terminal sheet that belongs over the base: the TAC over the
          sectional, the IFR area chart over the IFR charts. A Class B
          marker's card pins the same thing for its field. */}
      <ListRow id={tacId} title={base === "sec" ? "Terminal area chart" : "IFR area chart"} description="Over the chart wherever there is one">
        <Switch id={tacId} checked={tac} onCheckedChange={setTac} data-testid="tac-toggle" />
      </ListRow>
      <ListRow id={classBId} title="Class B airports" description="Their weather now; tap one for its chart">
        <Switch id={classBId} checked={classB} onCheckedChange={setClassB} data-testid="class-b-toggle" />
      </ListRow>
    </ListGroup>
  );
}

function CheckpointsGroup({ candidates }: { candidates?: PageSettings["candidates"] }) {
  const markerZoom = usePreferences(s => s.markerZoom);
  const setMarkerZoom = usePreferences(s => s.setMarkerZoom);
  const zoomId = useId();
  const allId = useId();
  return (
    <ListGroup title="Checkpoints">
      {/* How far in the map has to be before the markers draw: a long
          route fits the screen zoomed a long way out, where a few
          hundred of them would hide the chart. Named for what it
          sets, the map's zoom level; it was "Show from". A slider was
          tried here, and the menu of four stops kept. */}
      <ListRow id={zoomId} title="Zoom level" description="Zoomed out, markers hide the chart">
        <Select value={String(markerZoom)} onValueChange={value => setMarkerZoom(Number(value))}>
          <SelectTrigger id={zoomId} size="sm" aria-label="Zoom level checkpoints show from" data-testid="marker-zoom-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {MARKER_ZOOMS.map(m => <SelectItem key={m.from} value={String(m.from)}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </ListRow>
      {candidates && (
        <ListRow id={allId} title="Every rated landmark" description="The dim dots the checkpoints were chosen from">
          <Switch id={allId} checked={candidates.on} onCheckedChange={candidates.onToggle} data-testid="candidates-toggle" />
        </ListRow>
      )}
    </ListGroup>
  );
}

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
}

/** Own ship: the phone's position on the chart, and the map kept on it.
 *  The note says what the GPS has, or why there is nothing: no secure
 *  connection (the browser grants geolocation only to https or
 *  localhost), or access refused. Following ends when the pilot pans
 *  the map themselves (RouteMap turns it off on a drag). */
function PositionGroup() {
  const { enabled, follow, fix, error, setEnabled, setFollow } = useOwnShip();
  const available = ownShipAvailable();
  const showId = useId();
  const followId = useId();
  const status = !available
    ? "Needs a secure connection: open the app over https."
    : error ?? (!enabled
      ? "From the phone's GPS, drawn as a blue arrow."
      : !fix
        ? "Waiting for a position…"
        : `${coordinate(fix.lat, "N", "S")} ${coordinate(fix.lon, "E", "W")} · ±${Math.round(fix.accuracyM)} m`
          + (fix.speedKt !== null ? ` · ${Math.round(fix.speedKt)} kt` : "")
          + (fix.headingDeg !== null ? ` · ${String(Math.round(fix.headingDeg)).padStart(3, "0")}°` : ""));
  return (
    <ListGroup title="My position" footer={<span data-testid="own-ship-status">{status}</span>}>
      <ListRow id={showId} title="Show my position">
        <Switch id={showId} checked={enabled} disabled={!available} onCheckedChange={setEnabled} data-testid="own-ship-toggle" />
      </ListRow>
      <ListRow id={followId} title="Keep the map on me">
        <Switch id={followId} checked={follow} disabled={!available || !enabled} onCheckedChange={setFollow} data-testid="own-ship-follow" />
      </ListRow>
    </ListGroup>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

/** The theme (next-themes keeps it, and follows the OS on System: a
 *  pilot planning at night wants the page as dim as the panel lights),
 *  and the edge the route panel is on (useNavEdge). */
function AppearanceGroup() {
  const { theme, setTheme } = useTheme();
  const edge = useNavEdge();
  const setNavBar = usePreferences(s => s.setNavBar);
  return (
    <ListGroup title="Appearance">
      <ListRow title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </ListRow>
      <ListRow title="Navigation bar" description="The route panel and every sheet come from this edge; the map's buttons take the other">
        <Segmented
          label="Navigation bar" value={edge} onChange={v => setNavBar(v as NavEdge)} testId="nav-bar-select"
          options={[{ value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }]}
        />
      </ListRow>
    </ListGroup>
  );
}

/** Dev mode, for whoever it is for (useDevMode): the switch between the
 *  two pages, which a developer flips all day and a pilot never sees. */
function DeveloperGroup() {
  const { on, flip, allowed } = useDevMode();
  const id = useId();
  if (!allowed) return null;
  return (
    <ListGroup title="Developer">
      <ListRow id={id} title="Dev mode" description="The model training page, its console and its map">
        <Switch id={id} checked={on} onCheckedChange={flip} aria-label="Dev mode" data-testid="dev-switch" />
      </ListRow>
    </ListGroup>
  );
}

/** Two to three choices, all on show: shadcn's ToggleGroup as a
 *  segmented control -- the choice raised out of a muted track, as iOS
 *  draws one, every label in the text's colour at 13 points to a
 *  finger (the unchosen ones were grey, 4.35:1 on the track). Always
 *  one of them: a tap on the one already chosen keeps it rather than
 *  clearing the setting. */
function Segmented({ label, value, onChange, options, testId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon?: ReactNode }[];
  testId?: string;
}) {
  return (
    <ToggleGroup
      type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
      aria-label={label} size="sm" spacing={0.5} className="rounded-lg bg-muted p-0.5" data-testid={testId}
    >
      {options.map(o => (
        <ToggleGroupItem
          key={o.value} value={o.value}
          className="h-7 rounded-md px-2.5 text-xs pointer-coarse:text-[0.8125rem] text-foreground data-[state=on]:bg-background data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/30 [&_svg:not([class*='size-'])]:size-3.5"
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
