import { ListGroup, ListRow } from "../../components/GroupedList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { MINIMUM_CHOICES, type Minimums } from "../../lib/minimums";
import { usePreferences, type RouteWeather } from "../../lib/preferences";
import { feet, miles } from "../../lib/units";

/** How each minimum reads in its menu. */
const MINIMUM_ROWS: { key: keyof Minimums; title: string; unit: (n: number) => string }[] = [
  { key: "ceilingFt", title: "Ceiling", unit: feet },
  { key: "visibilitySm", title: "Visibility", unit: miles },
  { key: "crosswindKt", title: "Crosswind", unit: n => `${n} kt` },
  { key: "windKt", title: "Wind, with gusts", unit: n => `${n} kt` },
];

/** The pilot's personal minimums: the weather they will not take off or
 *  land in, each a menu, Off until picked. The briefing says where the
 *  weather is under them (lib/minimums). In the console's Personal tab,
 *  with the pilot's own airplanes, flights and logbook, at the pilot's
 *  ask; it was a group of Settings. Kept on this device, so it needs no
 *  sign-in. */
export default function MinimumsPanel() {
  const minimums = usePreferences(s => s.minimums);
  const setMinimum = usePreferences(s => s.setMinimum);
  const routeWeather = usePreferences(s => s.routeWeather);
  const setRouteWeather = usePreferences(s => s.setRouteWeather);
  return (
    // The briefing says where the weather is under them.
    <ListGroup title="Personal minimums">
      {MINIMUM_ROWS.map(({ key, title, unit }) => (
        <ListRow key={key} title={title}>
          <Select value={minimums[key] == null ? "off" : String(minimums[key])} onValueChange={v => setMinimum(key, v === "off" ? null : Number(v))}>
            <SelectTrigger size="sm" aria-label={`Minimum ${title.toLowerCase()}`} data-testid={`minimum-${key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="off">Off</SelectItem>
              {MINIMUM_CHOICES[key].map(n => <SelectItem key={n} value={String(n)}>{unit(n)}</SelectItem>)}
            </SelectContent>
          </Select>
        </ListRow>
      ))}
      {/* What FPL's Routes go round: these, or 14 CFR 91.155's alone --
          thunderstorms either way (lib/routeOptions), at the owner's "This
          can be a setting. But also avoid thunderstorms etc". */}
      <ListRow title="Routes keep to">
        <Select value={routeWeather} onValueChange={v => setRouteWeather(v as RouteWeather)}>
          <SelectTrigger size="sm" aria-label="Routes keep to" data-testid="route-weather">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="personal">These minimums</SelectItem>
            <SelectItem value="legal">VFR minimums</SelectItem>
          </SelectContent>
        </Select>
      </ListRow>
    </ListGroup>
  );
}
