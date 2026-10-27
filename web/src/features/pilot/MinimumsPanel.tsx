import { ListGroup, ListRow } from "../../components/GroupedList";
import PullDown from "../../components/PullDown";
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
          <PullDown
            label={`Minimum ${title.toLowerCase()}`} value={minimums[key] == null ? "off" : `${minimums[key]}`} testId={`minimum-${key}`}
            options={[{ value: "off", label: "Off" }, ...MINIMUM_CHOICES[key].map(n => ({ value: `${n}`, label: unit(n) }))]}
            onChange={v => setMinimum(key, v === "off" ? null : Number(v))}
          />
        </ListRow>
      ))}
      {/* What FPL's Routes go round: these, or 14 CFR 91.155's alone --
          thunderstorms either way (lib/routeOptions), at the owner's "This
          can be a setting. But also avoid thunderstorms etc". */}
      <ListRow title="Routes keep to">
        <PullDown<RouteWeather>
          label="Routes keep to" value={routeWeather} testId="route-weather" onChange={setRouteWeather}
          options={[{ value: "personal", label: "These minimums" }, { value: "legal", label: "VFR minimums" }]}
        />
      </ListRow>
    </ListGroup>
  );
}
