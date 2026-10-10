import { useState, type ReactNode } from "react";
import { CloudSun, FileText, Hand, Hexagon, Info, LifeBuoy, Lightbulb, Monitor, Moon, Palette, PanelBottom, PanelTop, Sparkles, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { ListGroup, ListRow } from "./GroupedList";
import AboutLimits from "./AboutLimits";
import Segmented from "./Segmented";
import { useNavEdge } from "../hooks/use-nav-edge";
import { usePreferences, type NarrativeFramework, type NavEdge, type RouteColours } from "../lib/preferences";
import { LEGAL_PAGES } from "../lib/legal";
import { useTips } from "../lib/tips";
import { SETTING_BADGE } from "../lib/rowBadges";
import { RowBadge } from "./RowBadge";

/**
 * The settings, the consoles' last tab (ConsoleTabs), laid out the way
 * iOS lays out Settings: a few groups under short headings, each a
 * rounded box of rows with a hairline between them, one label per row
 * with its control at the row's end, one tap each: a segmented control
 * where one of several is picked (Theme, Layout, Route), so it is not
 * taken for the console's tabs.
 * Appearance first -- the theme and the layout, the two that change
 * how all of it looks -- then the Brief's narrative and the tips. The
 * same on both pages, and remembered per browser. The map's settings
 * are the map's own button's (MapSettings), and the personal minimums
 * the Personal tab's (MinimumsPanel), at the pilot's ask.
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
 * has them, at the pilot's ask.
 */
export default function SettingsPanel() {
  return (
    <div className="@container/settings space-y-5 pb-1" data-testid="settings-panel">
      <AppearanceGroup />
      <BriefGroup />
      <TipsGroup />
      <AboutGroup />
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

const LEGAL_GLYPHS: Record<(typeof LEGAL_PAGES)[number]["key"], ReactNode> = {
  privacy: <Hand />, terms: <FileText />, support: <LifeBuoy />,
};

/** About & limits, then the privacy policy, terms and support pages
 *  (lib/legal), which App Review wants a link to inside the app: one
 *  group, where they were two under the same heading. */
function AboutGroup() {
  return (
    <ListGroup title="About">
      <AboutLimits media={badge("about", <Info />)} />
      {LEGAL_PAGES.map(p => (
        <ListRow key={p.key} media={badge("about", LEGAL_GLYPHS[p.key])} title={p.title} href={p.href} data-testid={`legal-${p.key}`} />
      ))}
    </ListGroup>
  );
}

/** A settings row's glyph on its colour (RowBadge). */
const badge = (kind: keyof typeof SETTING_BADGE, glyph: ReactNode) => <RowBadge colour={SETTING_BADGE[kind]}>{glyph}</RowBadge>;

/** The first-run tips (lib/tips), offered again from the start. */
function TipsGroup() {
  const reset = useTips(s => s.reset);
  const [asked, setAsked] = useState(false);
  return (
    <ListGroup title="Tips">
      <ListRow
        media={badge("tips", <Lightbulb />)}
        title={asked ? "Tips will show again" : "Show tips again"} disabled={asked}
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
  return (
    <ListGroup title="Appearance">
      <ListRow media={badge("theme", <SunMoon />)} title="Theme">
        <Segmented label="Theme" value={theme ?? "system"} onChange={setTheme} testId="theme-select" options={THEMES} />
      </ListRow>
      <ListRow media={badge("layout", <PanelBottom />)} title="Layout">
        <Segmented label="Layout" value={edge} onChange={v => setNavBar(v as NavEdge)} testId="nav-bar-select" options={LAYOUTS} />
      </ListRow>
      {/* The route box's airports by their airspace, as the sectional
          draws it, or by the weather, as the map's chips are. */}
      <ListRow media={badge("route", <Palette />)} title="Route">
        <Segmented
          label="Route colours" value={routeColours} onChange={v => setRouteColours(v as RouteColours)}
          testId="route-colours-select" options={ROUTE_COLOURS}
        />
      </ListRow>
    </ListGroup>
  );
}

