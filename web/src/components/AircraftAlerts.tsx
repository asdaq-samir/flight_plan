import { useEffect, useMemo, useRef } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import { cn } from "cn";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import IconButton from "./IconButton";
import { GLASS } from "./mapChrome";
import { airborneNow, alertKey, dismissFired as dismiss, fired, useFiredAlerts, type Watched } from "../lib/aircraftAlerts";
import type { FlightStatus } from "../lib/api/types";
import { useOwnShip } from "../lib/map/ownShip";
import { useTracking } from "../lib/map/tracking";
import { usePreferences } from "../lib/preferences";
import { flightStatusQuery } from "../lib/queryClient";
import { say } from "../lib/speech";
import { TEXT } from "../lib/text";

/** Each answer's state and when it came: the same answer is not read twice. */
const answers = (results: UseQueryResult<FlightStatus>[]) => results.map(r => ({ data: r.data, at: r.dataUpdatedAt }));

/**
 * Watches the airplanes the pilot asked to be told of (lib/aircraftAlerts):
 * each one's state asked every fifteen seconds while the app is open
 * (flightStatusQuery), each alert on it read against what was known
 * before, and one that goes off said on the map and aloud, then let go.
 */
function useAircraftAlertWatch() {
  const alerts = usePreferences(s => s.aircraftAlerts);
  const hexes = useMemo(() => [...new Set(alerts.map(a => a.hex))], [alerts]);
  const results = useQueries({ queries: hexes.map(hex => flightStatusQuery(hex)), combine: answers });
  const me = useOwnShip(s => (s.enabled ? s.fix : null));
  const watched = useRef(new Map<string, Watched>());
  const read = useRef(new Map<string, number>());
  useEffect(() => {
    results.forEach(({ data, at }, i) => {
      const hex = hexes[i];
      if (!hex || !data || read.current.get(hex) === at) return;
      read.current.set(hex, at);
      const before = watched.current.get(hex) ?? { airborne: null, inside: {} };
      const airborne = airborneNow(before.airborne, data);
      const inside = { ...before.inside };
      for (const alert of alerts.filter(a => a.hex === hex)) {
        const out = fired(alert, before, airborne, data, me, Date.now());
        if (out.inside !== undefined) inside[alertKey(alert)] = out.inside;
        if (!out.alert) continue;
        const went = out.alert;
        useFiredAlerts.setState(s => ({ fired: [...s.fired, went] }));
        say(went.spoken);
        // Said once, as FlightAware's alert for a flight is: set again to hear it again.
        usePreferences.getState().removeAircraftAlert(alert.hex, alert.kind);
      }
      watched.current.set(hex, { airborne, inside });
    });
    // An airplane no longer watched is forgotten, so set again it starts afresh.
    for (const hex of [...watched.current.keys()]) {
      if (!hexes.includes(hex)) {
        watched.current.delete(hex);
        read.current.delete(hex);
      }
    }
  }, [results, hexes, alerts, me]);
}

/**
 * The airplanes' alerts as they go off, on the map with the alerts ahead
 * (MapBanners), at the owner's pick of the redesign: what happened and
 * where ("N654FL landed at KDAW", "Skyhaven · 18:42"), Show opening its
 * card, and the cross putting it away.
 */
export default function AircraftAlerts() {
  useAircraftAlertWatch();
  const shown = useFiredAlerts(s => s.fired);
  return shown.map(alert => (
    <div key={alert.id} className={cn(GLASS, "pointer-events-auto w-fit max-w-full rounded-[22px]")} data-testid="aircraft-alert">
      <Alert role="alert" className="flex min-h-11 items-center gap-2 rounded-[22px] border-transparent bg-transparent py-1 pr-1 pl-3 *:[svg]:translate-y-0">
        <BellRing className="shrink-0 text-tint" />
        <div className={cn("flex min-w-0 flex-1 flex-col py-1", TEXT.detail)}>
          <span className="truncate font-semibold text-foreground" data-testid="aircraft-alert-title">{alert.title}</span>
          {alert.detail && <span className="truncate text-muted-foreground">{alert.detail}</span>}
        </div>
        <Button
          type="button" size="sm" variant="ghost" className="shrink-0 rounded-full text-tint" data-testid="aircraft-alert-show"
          onClick={() => {
            // Its card, where the planner is open; from another page, the planner on it.
            const pick = useTracking.getState().pick;
            if (pick) pick(alert.hex);
            else window.location.assign(`/app/plan?flight=${alert.hex}`);
            dismiss(alert.id);
          }}
        >
          Show
        </Button>
        <IconButton label="Dismiss" className="shrink-0 rounded-full" onClick={() => dismiss(alert.id)} data-testid="aircraft-alert-dismiss">
          <X />
        </IconButton>
      </Alert>
    </div>
  ));
}
