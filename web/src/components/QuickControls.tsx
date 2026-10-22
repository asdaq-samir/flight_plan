import type { ReactNode } from "react";
import { Bell, Moon, Plane, Volume2 } from "lucide-react";
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
 * a round mark filled in the tint while on, its word under it: the
 * traffic, the alerts in flight and their voice, and dark mode for night.
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
  const alerts = usePreferences(s => s.alerts);
  const spoken = usePreferences(s => s.speakAlerts);
  const set = usePreferences.getState();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div
      className="grid grid-cols-4 gap-x-1"
      data-testid="quick-controls"
    >
      <Quick on={traffic} onChange={set.setTraffic} icon={<Plane />} label="Traffic" testId="quick-traffic" />
      <Quick on={alerts} onChange={set.setAlerts} icon={<Bell />} label="Alerts" testId="quick-alerts" />
      <Quick
        on={alerts && spoken} disabled={!alerts} icon={<Volume2 />} label="Spoken" testId="quick-spoken"
        onChange={on => { set.setSpeakAlerts(on); if (on) say("Alerts will be spoken."); }}
      />
      <Quick on={resolvedTheme === "dark"} onChange={on => setTheme(on ? "dark" : "light")} icon={<Moon />} label="Dark" testId="quick-dark" />
    </div>
  );
}

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
