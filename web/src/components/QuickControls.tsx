import type { ReactNode } from "react";
import { Bell, CloudSun, Download, Map as MapIcon, MapPin, Moon, Plane, ShieldAlert, ShieldX, Volume2 } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "cn";
import { Toggle } from "./ui/toggle";
import { say } from "../lib/speech";
import { usePreferences } from "../lib/preferences";
import { TEXT } from "../lib/text";

/**
 * The Settings tab's pill, under the tab bar, at the owner's ask
 * ("Settings can show quick controls"): the switches a pilot reaches for
 * in the cockpit, one tap each, as iOS's Control Center lays them out --
 * a round mark filled in the tint while on, its word under it. The
 * traffic, TFRs, the alerts in flight and their voice (the map's settings,
 * MapSettings, has each in full), and dark mode for night. Stock Toggles:
 * each says it is on with aria-pressed.
 *
 * Two rows, at the owner's ask ("for settings double row of quick
 * controls"), the pill as tall as FPL's: under the first, the map's own --
 * the Class B fields' weather and their terminal sheet, the route's
 * waypoints, the military fields and the charts kept for offline.
 */
export default function QuickControls() {
  const traffic = usePreferences(s => s.traffic);
  const tfrs = usePreferences(s => s.tfrs);
  const alerts = usePreferences(s => s.alerts);
  const spoken = usePreferences(s => s.speakAlerts);
  const set = usePreferences.getState();
  const classB = usePreferences(s => s.classB);
  const tac = usePreferences(s => s.tac);
  const base = usePreferences(s => s.base);
  const waypoints = usePreferences(s => s.waypoints);
  const military = usePreferences(s => s.military);
  const keepOffline = usePreferences(s => s.keepOffline);
  // Over plain http no service worker holds the charts (keepRoute's
  // keepingAvailable, the same test: that module's diagrams and tiles kept
  // out of the first load).
  const offline = "serviceWorker" in navigator && window.isSecureContext;
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-5 gap-x-1 gap-y-2" data-testid="quick-controls">
      <Quick on={traffic} onChange={set.setTraffic} icon={<Plane />} label="Traffic" testId="quick-traffic" />
      <Quick on={tfrs} onChange={set.setTfrs} icon={<ShieldAlert />} label="TFRs" testId="quick-tfrs" />
      <Quick on={alerts} onChange={set.setAlerts} icon={<Bell />} label="Alerts" testId="quick-alerts" />
      <Quick
        on={alerts && spoken} disabled={!alerts} icon={<Volume2 />} label="Spoken" testId="quick-spoken"
        onChange={on => { set.setSpeakAlerts(on); if (on) say("Alerts will be spoken."); }}
      />
      <Quick on={resolvedTheme === "dark"} onChange={on => setTheme(on ? "dark" : "light")} icon={<Moon />} label="Dark" testId="quick-dark" />
      <Quick on={classB} onChange={set.setClassB} icon={<CloudSun />} label="Weather" testId="quick-weather" />
      <Quick on={tac} onChange={set.setTac} icon={<MapIcon />} label={base === "sec" ? "TAC" : "Area"} testId="quick-tac" />
      <Quick on={waypoints} onChange={set.setWaypoints} icon={<MapPin />} label="Points" testId="quick-waypoints" />
      <Quick on={military} onChange={set.setMilitary} icon={<ShieldX />} label="Military" testId="quick-military" />
      <Quick
        on={keepOffline && offline} disabled={!offline} onChange={set.setKeepOffline} icon={<Download />} label="Offline"
        testId="quick-offline"
      />
    </div>
  );
}

function Quick({ on, onChange, icon, label, testId, disabled }: {
  on: boolean;
  onChange: (on: boolean) => void;
  icon: ReactNode;
  label: string;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <Toggle
      pressed={on} onPressedChange={onChange} disabled={disabled} data-testid={testId}
      className="group h-auto min-h-11 w-full min-w-0 flex-col gap-0.5 rounded-lg p-0.5 hover:bg-muted/50 data-[state=on]:bg-transparent"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-full bg-muted text-foreground group-data-[state=on]:bg-primary group-data-[state=on]:text-primary-foreground [&_svg]:size-3.5"
      >
        {icon}
      </span>
      <span className={cn("max-w-full truncate font-medium leading-tight text-foreground", TEXT.note)}>{label}</span>
    </Toggle>
  );
}
