import { useId, useState, type ReactNode } from "react";
import { Bell, CloudSun, Download, Hexagon, Lightbulb, Monitor, Moon, Palette, PanelBottom, PanelTop, Radio, Sparkles, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented from "./Segmented";
import { Switch } from "./ui/switch";
import { useNavEdge } from "../hooks/use-nav-edge";
import { useDevMode } from "../hooks/use-dev-mode";
import { usePreferences, type Brand, type NarrativeFramework, type NavEdge, type RouteColours } from "../lib/preferences";
import { BRANDS } from "../lib/brand";
import { useTips } from "../lib/tips";
import { SETTING_BADGE } from "../lib/rowBadges";
import { RowBadge } from "./RowBadge";
import PullDown from "./PullDown";
import { ALERT_MODES, useAlertMode, type AlertMode } from "../lib/alertMode";
import { keepingAvailable } from "../lib/map/keepRoute";
import { inNativeApp } from "../lib/native";
import { useReceiver } from "../lib/map/receiver";

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end, one tap each: a segmented control
 * where one of several is picked (Theme, Layout, Route), so it is not
 * taken for the console's tabs.
 * Appearance first -- the look, the theme and the layout, which change
 * how all of it looks -- then In Flight, what works in the air whatever
 * the map shows, then (for a developer) the Brief's narrative and the
 * tips. The same on both pages, and remembered per browser. The map's
 * settings, the chart at night and own ship's look among them, are the
 * map's own button's (MapSettings), and the personal minimums the
 * Personal tab's (MinimumsPanel), at the pilot's ask.
 *
 * Who is signed in, the role (dev mode) and Sign out are the console's
 * title row (ConsoleHeader); the pilot's own position is the map's
 * location arrow (MyPositionButton), where it was two switches here.
 * The waypoints were the planner's group of their own, a menu of four
 * zoom levels and a switch for the landmarks they were chosen from. It
 * all replaced a column of headings, checkboxes, dropdowns and a
 * paragraph under nearly every control, twice the height; the last two
 * lines under a group went too, at the pilot's ask: no descriptions.
 * Each row leads with its glyph in a colour of its own, as iOS's Settings
 * has them, at the pilot's ask. What the app is, its limits, its sources
 * and the legal pages are the next tab's, About (AboutPanel).
 */
export default function SettingsPanel() {
  const developer = useDevMode().allowed;
  return (
    <div className="@container/settings space-y-5 pb-1" data-testid="settings-panel">
      <AppearanceGroup />
      <InFlightGroup />
      {/* Which agent writes the Brief's narrative is the developer's to
          pick, at the owner's word (2026-10-27): a pilot gets the
          default. */}
      {developer && <BriefGroup />}
      <TipsGroup />
    </div>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

const LAYOUTS = [
  { value: "top", label: "Top", icon: <PanelTop /> },
  { value: "bottom", label: "Bottom", icon: <PanelBottom /> },
];

const ROUTE_COLOURS = [
  { value: "airspace", label: "Airspace", icon: <Hexagon /> },
  { value: "metar", label: "Weather", icon: <CloudSun /> },
];

const NARRATIVES = [
  { value: "langgraph", label: "LangGraph" },
  { value: "crewai", label: "CrewAI" },
];

/** A settings row's glyph on its colour (RowBadge). */
const badge = (kind: keyof typeof SETTING_BADGE, glyph: ReactNode) => <RowBadge colour={SETTING_BADGE[kind]}>{glyph}</RowBadge>;

/** What works in the air whatever the map shows, set before a flight:
 *  the alerts of what is ahead and their voice, the charts kept for when
 *  there is no connection, and in the app the cockpit receiver. They were
 *  the map's settings (MapSettings), at the owner's pick (2026-10-27). */
function InFlightGroup() {
  const [alertMode, setAlertMode] = useAlertMode();
  const keepOffline = usePreferences(s => s.keepOffline);
  const setKeepOffline = usePreferences(s => s.setKeepOffline);
  const traffic = usePreferences(s => s.traffic);
  const available = keepingAvailable();
  const offlineId = useId();
  return (
    <ListGroup title="In Flight">
      {/* What is ahead of own ship in the air, over the map (AlertsBanner),
          and said aloud (lib/map/speak): one control of three settings, at
          the owner's ask ("Shouldn't this be combined control?"), where
          the voice was a switch that did nothing with the alerts off. */}
      <ListRow media={badge("alerts", <Bell />)} title="Alerts">
        <Segmented label="Alerts" value={alertMode} onChange={v => setAlertMode(v as AlertMode)} testId="alerts-mode" options={ALERT_MODES} />
      </ListRow>
      {/* The base chart along each route loaded, held for the air
          (useKeepOffline); how a keep goes is its toast. Over plain http
          there is no service worker to hold it, and it cannot be on. */}
      <ListRow id={offlineId} media={badge("offline", <Download />)} title="Keep Charts Offline">
        <Switch
          id={offlineId} checked={keepOffline && available} onCheckedChange={setKeepOffline} disabled={!available}
          data-testid="keep-offline-toggle"
        />
      </ListRow>
      {/* A cockpit receiver's traffic (lib/map/receiver), heard in the app
          while the traffic is shown: what it is doing, in words. */}
      {inNativeApp() && <ListRow media={badge("receiver", <Radio />)} title="Receiver" value={<ReceiverStatus on={traffic} />} />}
    </ListGroup>
  );
}

/** The cockpit receiver, in a few words: whether it is heard, and what. */
function ReceiverStatus({ on }: { on: boolean }) {
  const listening = useReceiver(s => s.listening);
  const connected = useReceiver(s => s.connected);
  const count = useReceiver(s => Object.keys(s.traffic).length);
  const error = useReceiver(s => s.error);
  const words = !on ? "With Traffic on"
    : error ? "Can't listen on the Wi-Fi"
      : connected ? `Connected · ${count} ${count === 1 ? "airplane" : "airplanes"}`
        : listening ? "Listening on the Wi-Fi" : "Starting…";
  return <span className={connected && on ? "font-semibold text-foreground" : "text-muted-foreground"} data-testid="receiver-status">{words}</span>;
}

/** The first-run tips (lib/tips), offered again from the start. */
function TipsGroup() {
  const reset = useTips(s => s.reset);
  const [asked, setAsked] = useState(false);
  return (
    <ListGroup title="Tips">
      <ListRow
        media={badge("tips", <Lightbulb />)}
        title={asked ? "Tips Will Show Again" : "Show Tips Again"} disabled={asked}
        onClick={() => { reset(); setAsked(true); }} data-testid="tips-reset"
      />
    </ListGroup>
  );
}

/** Which agent writes the Brief tab's narrative, at the pilot's ask: it
 *  was a switch over the narrative, in the way of reading it. */
function BriefGroup() {
  const narrative = usePreferences(s => s.narrative);
  const setNarrative = usePreferences(s => s.setNarrative);
  return (
    <ListGroup title="Brief">
      <ListRow media={badge("narrative", <Sparkles />)} title="Narrative">
        <Segmented
          label="Narrative from" value={narrative} onChange={v => setNarrative(v as NarrativeFramework)}
          testId="narrative-framework" options={NARRATIVES}
        />
      </ListRow>
    </ListGroup>
  );
}

/** The theme (next-themes keeps it, and follows the OS on System: a
 *  pilot planning at night wants the page as dim as the panel lights),
 *  and the layout -- the edge the route panel is on, which the sheets
 *  come from too and the map's buttons keep clear of (useNavEdge) --
 *  drawn alike, each choice with its picture. It was "Navigation bar",
 *  in a menu. */
function AppearanceGroup() {
  const { theme, setTheme } = useTheme();
  const edge = useNavEdge();
  const setNavBar = usePreferences(s => s.setNavBar);
  const routeColours = usePreferences(s => s.routeColours);
  const setRouteColours = usePreferences(s => s.setRouteColours);
  const brand = usePreferences(s => s.brand);
  const setBrand = usePreferences(s => s.setBrand);
  return (
    <ListGroup title="Appearance">
      {/* The app's look, the owner's four (lib/brand): a menu, as a
          discrete choice is, not a slider. */}
      <ListRow media={badge("look", <Palette />)} title="Look">
        <PullDown<Brand>
          label="Look" value={brand} onChange={setBrand} testId="brand-select"
          options={BRANDS.map(b => ({ value: b.value, label: b.label, testId: `brand-${b.value}` }))}
        />
      </ListRow>
      <ListRow media={badge("theme", <SunMoon />)} title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </ListRow>
      <ListRow media={badge("layout", <PanelBottom />)} title="Layout">
        <Segmented label="Layout" value={edge} onChange={v => setNavBar(v as NavEdge)} testId="nav-bar-select" options={LAYOUTS} />
      </ListRow>
      {/* The route box's airports by their airspace, as the sectional
          draws it, or by the weather, as the map's chips are. */}
      <ListRow media={badge("route", <Palette />)} title="Route Airports">
        <Segmented
          label="Route colours" value={routeColours} onChange={v => setRouteColours(v as RouteColours)}
          testId="route-colours-select" options={ROUTE_COLOURS}
        />
      </ListRow>
    </ListGroup>
  );
}

