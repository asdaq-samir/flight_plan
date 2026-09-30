import { Children, Fragment, useId, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "./ui/item";
import { Label } from "./ui/label";
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
 * The header's settings, laid out the way iOS lays out Settings: a few
 * groups under short headings, each a rounded box of rows with a hairline
 * between them, one label per row with its control at the row's end, and
 * at most a line of help. A switch for anything on or off, a segmented
 * control for two or three choices, all on show and one tap each, and a
 * menu only for the four-way one. The map first, what is changed most
 * while planning; then the checkpoints, the pilot's own position, and
 * appearance. Dev mode is not a group but the title row's switch
 * (DevModeSwitch). Everything else here is remembered per browser.
 *
 * It replaced a column of headings, checkboxes, dropdowns and a
 * paragraph under nearly every control, twice the height, where a
 * two-way choice took two taps in a menu; the theme, which was an icon
 * cycling through three states in the console's tab row, is here too.
 */
export default function SettingsPanel({ page }: { page?: PageSettings }) {
  return (
    <div className="space-y-5 pb-1" data-testid="settings-panel">
      <MapGroup />
      <CheckpointsGroup candidates={page?.candidates} />
      {page?.ownShip && <PositionGroup />}
      <AppearanceGroup />
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
    <Group title="Map">
      <Row title="Chart">
        <Segmented
          label="Chart" value={base} onChange={v => setBase(v as BaseChart)} testId="base-chart-select"
          options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label }))}
        />
      </Row>
      {/* The terminal sheet that belongs over the base: the TAC over the
          sectional, the IFR area chart over the IFR charts. A Class B
          marker's card pins the same thing for its field. */}
      <Row id={tacId} title={base === "sec" ? "Terminal area chart" : "IFR area chart"} description="Over the chart wherever there is one">
        <Switch id={tacId} checked={tac} onCheckedChange={setTac} data-testid="tac-toggle" />
      </Row>
      <Row id={classBId} title="Class B airports" description="Their weather now; tap one for its chart">
        <Switch id={classBId} checked={classB} onCheckedChange={setClassB} data-testid="class-b-toggle" />
      </Row>
    </Group>
  );
}

function CheckpointsGroup({ candidates }: { candidates?: PageSettings["candidates"] }) {
  const markerZoom = usePreferences(s => s.markerZoom);
  const setMarkerZoom = usePreferences(s => s.setMarkerZoom);
  const zoomId = useId();
  const allId = useId();
  return (
    <Group title="Checkpoints">
      {/* How far in the map has to be before the markers draw: a long
          route fits the screen zoomed a long way out, where a few
          hundred of them would hide the chart. */}
      <Row id={zoomId} title="Show from" description="Zoomed out, markers hide the chart">
        <Select value={String(markerZoom)} onValueChange={value => setMarkerZoom(Number(value))}>
          <SelectTrigger id={zoomId} size="sm" aria-label="Show checkpoints from" data-testid="marker-zoom-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {MARKER_ZOOMS.map(m => <SelectItem key={m.from} value={String(m.from)}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Row>
      {candidates && (
        <Row id={allId} title="Every rated landmark" description="The dim dots the checkpoints were chosen from">
          <Switch id={allId} checked={candidates.on} onCheckedChange={candidates.onToggle} data-testid="candidates-toggle" />
        </Row>
      )}
    </Group>
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
    <Group title="My position" footer={<span data-testid="own-ship-status">{status}</span>}>
      <Row id={showId} title="Show my position">
        <Switch id={showId} checked={enabled} disabled={!available} onCheckedChange={setEnabled} data-testid="own-ship-toggle" />
      </Row>
      <Row id={followId} title="Keep the map on me">
        <Switch id={followId} checked={follow} disabled={!available || !enabled} onCheckedChange={setFollow} data-testid="own-ship-follow" />
      </Row>
    </Group>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

/** The theme (next-themes keeps it, and follows the OS on System: a
 *  pilot planning at night wants the page as dim as the panel lights),
 *  and the edge the header is on (useNavEdge). */
function AppearanceGroup() {
  const { theme, setTheme } = useTheme();
  const edge = useNavEdge();
  const setNavBar = usePreferences(s => s.setNavBar);
  return (
    <Group title="Appearance">
      <Row title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </Row>
      <Row title="Navigation bar" description="Panels come in from the same edge">
        <Segmented
          label="Navigation bar" value={edge} onChange={v => setNavBar(v as NavEdge)} testId="nav-bar-select"
          options={[{ value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }]}
        />
      </Row>
    </Group>
  );
}

/** Dev mode, at the end of the settings' title row, for whoever it is
 *  for (useDevMode): the switch between the two pages, which a developer
 *  flips all day and a pilot never sees. It was a group of its own at
 *  the top of the panel, with a Done where it is now. */
export function DevModeSwitch() {
  const { on, flip, allowed } = useDevMode();
  const id = useId();
  if (!allowed) return null;
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">Dev mode</Label>
      <Switch id={id} checked={on} onCheckedChange={flip} aria-label="Dev mode" data-testid="dev-switch" />
    </div>
  );
}

/** A heading, the rows in one rounded box with a hairline between each,
 *  and a note under the box. */
function Group({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  const id = useId();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="px-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ItemGroup role="group" aria-labelledby={id} className="gap-0 rounded-lg border border-border bg-card">
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <ItemSeparator className="my-0" />}
            {row}
          </Fragment>
        ))}
      </ItemGroup>
      {footer && <p className="px-1 pt-1.5 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

/** One setting: its name (a label for the control when `id` is given,
 *  so a tap on the words works the control) and a line of help, and the
 *  control at the row's end -- under the words, when the row is too
 *  narrow for both. */
function Row({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Item size="sm" className="min-h-11 rounded-none border-0 py-2">
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="font-normal">
          {id ? <Label htmlFor={id} className="font-normal">{title}</Label> : title}
        </ItemTitle>
        {description && <ItemDescription className="text-xs">{description}</ItemDescription>}
      </ItemContent>
      <ItemActions className="ml-auto">{children}</ItemActions>
    </Item>
  );
}

/** Two to three choices, all on show: shadcn's ToggleGroup as a
 *  segmented control -- the choice raised out of a muted track, as iOS
 *  draws one. Always one of them: a tap on the one already chosen
 *  keeps it rather than clearing the setting. */
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
          className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/30 [&_svg:not([class*='size-'])]:size-3.5"
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
