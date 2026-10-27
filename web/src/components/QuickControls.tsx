import type { ReactNode } from "react";
import { Bell, BellOff, BellRing, ChevronsUpDown, Monitor, Moon, Palette, PanelBottom, PanelTop, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "cn";
import PullDown, { type PullDownOption } from "./PullDown";
import { usePreferences, type Brand, type NavEdge } from "../lib/preferences";
import { BRANDS } from "../lib/brand";
import { useNavEdge } from "../hooks/use-nav-edge";
import { ALERT_MODES, useAlertMode, type AlertMode } from "../lib/alertMode";
import { TEXT } from "../lib/text";

/**
 * Setup's Controls, the only home of the four things a pilot changes in
 * the cockpit, at the owner's split (2026-10-27): "Controls can be alerts,
 * offline, layout, theme", everything else in the map's menu, and no
 * Settings page; App Look in Offline's place since (the owner, the same
 * day), the charts kept offline in the map's menu. Four big tiles, as iOS's Control Center lays its out, at
 * the owner's pick of the Setup canvas (T3): each a round mark filled in
 * the tint while on, its name, and its setting under it. Alerts, Layout
 * and Theme are a pick of a few, a tap their menu, as Apple Maps' voice
 * is -- not a cycle a pilot cannot foresee; Offline is on or off.
 *
 * Traffic went to the map's menu, a layer of the map's, and Dark became
 * Theme, keeping System, which a Dark switch could not say.
 */
export default function QuickControls() {
  const brand = usePreferences(s => s.brand);
  const setBrand = usePreferences(s => s.setBrand);
  const setNavBar = usePreferences(s => s.setNavBar);
  const edge = useNavEdge();
  const [alertMode, setAlertMode] = useAlertMode();
  const { theme, setTheme } = useTheme();
  const picked = theme === "light" || theme === "dark" ? theme : "system";
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="quick-controls">
      <MenuTile<AlertMode>
        label="Alerts" value={alertMode} onChange={setAlertMode} on={alertMode !== "off"} testId="alerts-mode"
        icon={alertMode === "off" ? <BellOff /> : alertMode === "spoken" ? <BellRing /> : <Bell />}
        options={ALERT_MODES.map(m => ({ value: m.value, label: m.label, testId: `alerts-mode-${m.value}` }))}
      />
      {/* The app's look, the owner's four (lib/brand), its Theme, where
          Offline was, named so at the owner's yes (2026-10-27): what most
          apps call a theme, and System, Light and Dark iOS's Appearance.
          It was "App Look", put here at the owner's ask ("instead of
          offline, let's have app look"); the charts kept offline went to
          the map's menu. */}
      <MenuTile<Brand>
        label="Theme" value={brand} onChange={setBrand} on={false} testId="brand-select" icon={<Palette />}
        options={BRANDS.map(b => ({ value: b.value, label: b.label, testId: `brand-${b.value}` }))}
      />
      {/* The edge the route panel is on, which the sheets come from too
          and the map's buttons keep clear of (useNavEdge). */}
      <MenuTile<NavEdge>
        label="Layout" value={edge} onChange={setNavBar} on={false} testId="nav-bar-select"
        icon={edge === "top" ? <PanelTop /> : <PanelBottom />}
        options={[{ value: "top", label: "Top", testId: "nav-bar-top" }, { value: "bottom", label: "Bottom", testId: "nav-bar-bottom" }]}
      />
      {/* Light or dark, Appearance as iOS names it (Display & Brightness),
          next-themes keeping it and following the phone on System: a
          pilot planning at night wants the page as dim as the panel
          lights. */}
      <MenuTile<"system" | "light" | "dark">
        label="Appearance" value={picked} onChange={setTheme} on={false} testId="theme-select"
        icon={picked === "dark" ? <Moon /> : picked === "light" ? <Sun /> : <Monitor />}
        options={[
          { value: "system", label: "System", testId: "theme-system" },
          { value: "light", label: "Light", testId: "theme-light" },
          { value: "dark", label: "Dark", testId: "theme-dark" },
        ]}
      />
    </div>
  );
}

/** A control's tile: a rounded card, its mark at the left, its name over
 *  its setting. Its own height is past 44, so it needs no area of its
 *  own. */
const TILE = cn(
  "group flex h-auto min-h-14 w-full min-w-0 items-center justify-start gap-2.5 rounded-2xl bg-card px-2.5 py-2 text-left outline-none",
  "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=on]:bg-card",
);

function Face({ icon, label, value, menu = false }: { icon: ReactNode; label: string; value: string; menu?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-foreground group-data-[state=on]:bg-primary group-data-[state=on]:text-primary-foreground [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("truncate font-semibold text-foreground", TEXT.detail)}>{label}</span>
        <span className={cn("flex items-center gap-0.5 truncate", menu ? "text-tint" : "text-muted-foreground", TEXT.note)}>
          {value}{menu && <ChevronsUpDown className="size-3 shrink-0" aria-hidden />}
        </span>
      </span>
    </>
  );
}

/** A tile that is a pick of a few: a tap its menu (PullDown), the one
 *  picked under its name. */
function MenuTile<V extends string>({ label, value, onChange, options, icon, on, testId }: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: PullDownOption<V>[];
  icon: ReactNode;
  /** Its mark filled in the tint, as a toggle's while on. */
  on: boolean;
  testId: string;
}) {
  const words = String(options.find(o => o.value === value)?.label ?? "");
  return (
    <PullDown
      label={label} value={value} onChange={onChange} options={options} align="start"
      trigger={(
        <button type="button" aria-label={`${label}: ${words}`} data-testid={testId} data-state={on ? "on" : "off"} className={TILE}>
          <Face icon={icon} label={label} value={words} menu />
        </button>
      )}
    />
  );
}
