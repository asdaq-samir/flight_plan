import { usePreferences } from "./preferences";
import { say } from "./speech";

/** The in-flight alerts as one choice, at the owner's ask ("Shouldn't this
 *  be combined control?", 2026-10-27): off, shown, or shown and said
 *  aloud. Saying them was a switch of its own that did nothing with the
 *  alerts off. Kept as the two preferences underneath. */
export type AlertMode = "off" | "on" | "spoken";

export const ALERT_MODES: { value: AlertMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
  { value: "spoken", label: "Spoken" },
];

export function useAlertMode(): [AlertMode, (mode: AlertMode) => void] {
  const alerts = usePreferences(s => s.alerts);
  const spoken = usePreferences(s => s.speakAlerts);
  const mode: AlertMode = !alerts ? "off" : spoken ? "spoken" : "on";
  const set = (next: AlertMode) => {
    const prefs = usePreferences.getState();
    prefs.setAlerts(next !== "off");
    prefs.setSpeakAlerts(next === "spoken");
    // Said once as it is turned on: a voice heard then is one the pilot
    // knows to expect, and on an iPhone the tap lets the page speak at all.
    if (next === "spoken" && mode !== "spoken") say("Alerts will be spoken.");
  };
  return [mode, set];
}
