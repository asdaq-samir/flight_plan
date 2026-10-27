import type { ReactNode } from "react";
import { Bell, BellOff, BellRing, Download, Moon, Plane } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "cn";
import { Toggle } from "./ui/toggle";
import PullDown from "./PullDown";
import { ALERT_MODES, useAlertMode } from "../lib/alertMode";
import { keepingAvailable } from "../lib/map/keepRoute";
import { usePreferences } from "../lib/preferences";
import { TEXT } from "../lib/text";

/**
 * The Settings tab's pill, under the tab bar, at the owner's ask
 * ("Settings can show quick controls"): the switches a pilot reaches for
 * in the cockpit, one tap each, as iOS's Control Center lays them out --
 * a round mark filled in the tint while on, its word under it: the
 * traffic, the alerts in flight, the charts kept offline, and dark mode for
 * night. The alerts are one control of three settings, Off, On and Spoken,
 * at the owner's ask (2026-10-27: "Shouldn't this be combined control?"):
 * their voice was a fourth button that did nothing with them off. Its tap
 * a menu, as Apple Maps' voice is, not a cycle a pilot cannot foresee;
 * the slot it freed holds the charts kept offline, set before a flight.
 * Stock Toggles: each says it is on with aria-pressed.
 *
 * Those four alone, one row, at the owner's ask ("so just the four",
 * 2026-10-22): the rest -- TFRs, the Class B fields' weather and their
 * terminal sheet, the route's checkpoints, the military fields and the
 * charts kept for offline -- are set once and left, in the map's
 * settings (MapSettings), where each still is. TFRs most of all, which a
 * pilot must know of on every flight (14 CFR 91.103): one tap from hidden
 * in the cockpit was one too near.
 */
export default function QuickControls() {
  const traffic = usePreferences(s => s.traffic);
  const keepOffline = usePreferences(s => s.keepOffline);
  const [alertMode, setAlertMode] = useAlertMode();
  const set = usePreferences.getState();
  const available = keepingAvailable();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div
      className="grid grid-cols-4 gap-x-1"
      data-testid="quick-controls"
    >
      <Quick on={traffic} onChange={set.setTraffic} icon={<Plane />} label="Traffic" testId="quick-traffic" />
      <PullDown
        label="Alerts" value={alertMode} onChange={setAlertMode} align="center"
        options={ALERT_MODES.map(m => ({ value: m.value, label: m.label, testId: `quick-alerts-${m.value}` }))}
        trigger={(
          <button type="button" aria-label={`Alerts: ${ALERT_MODES.find(m => m.value === alertMode)!.label}`} data-testid="quick-alerts" data-state={alertMode === "off" ? "off" : "on"} className={QUICK}>
            <span aria-hidden="true" className={MARK}>
              {alertMode === "off" ? <BellOff /> : alertMode === "spoken" ? <BellRing /> : <Bell />}
            </span>
            <span className={cn("max-w-full truncate font-medium leading-tight text-foreground", TEXT.note)}>
              {alertMode === "spoken" ? "Spoken" : "Alerts"}
            </span>
          </button>
        )}
      />
      <Quick
        on={keepOffline && available} disabled={!available} onChange={set.setKeepOffline} icon={<Download />}
        label="Offline" spoken="Keep charts offline" testId="quick-offline"
      />
      <Quick on={resolvedTheme === "dark"} onChange={on => setTheme(on ? "dark" : "light")} icon={<Moon />} label="Dark" testId="quick-dark" />
    </div>
  );
}

/** A control's tile, a Toggle or the alerts' menu button alike: a round
 *  mark filled in the tint while on, its word under it. */
const QUICK = "group inline-flex h-auto min-h-11 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg p-0.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=on]:bg-transparent";
const MARK = "grid size-7 place-items-center rounded-full bg-muted text-foreground group-data-[state=on]:bg-primary group-data-[state=on]:text-primary-foreground [&_svg]:size-3.5";

function Quick({ on, onChange, icon, label, spoken, testId, disabled }: {
  on: boolean;
  onChange: (on: boolean) => void;
  icon: ReactNode;
  label: string;
  /** Its whole name to a screen reader, where the tile's is short. */
  spoken?: string;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <Toggle
      pressed={on} onPressedChange={onChange} disabled={disabled} data-testid={testId} aria-label={spoken}
      className={QUICK}
    >
      <span aria-hidden="true" className={MARK}>
        {icon}
      </span>
      <span className={cn("max-w-full truncate font-medium leading-tight text-foreground", TEXT.note)}>{label}</span>
    </Toggle>
  );
}
