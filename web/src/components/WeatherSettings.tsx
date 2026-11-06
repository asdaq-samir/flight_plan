import { ChevronDown, CloudLightning, Eye, EyeOff, Radar, Satellite } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "./GroupedList";
import TogglePill from "./TogglePill";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useWeatherLayers, type WindsAt } from "../lib/map/weatherLayers";
import { TEXT } from "../lib/text";

/** The winds aloft's altitudes: the plan's cruise, or one of the FD
 *  product's own, written FL and hundreds of feet as the map's weather
 *  writes every altitude, the owner's pick (lib/weatherMap altitudeWords). */
const WINDS: { value: WindsAt; label: string }[] = [
  { value: "off", label: "Off" }, { value: "plan", label: "The plan's" },
  { value: 3000, label: "FL030" }, { value: 6000, label: "FL060" }, { value: 9000, label: "FL090" },
  { value: 12000, label: "FL120" }, { value: 18000, label: "FL180" },
];

/**
 * The weather the map draws (lib/map/WeatherLayer), first in the map's
 * own button's sheet, at the owner's pick (the canvas's map weather, A:
 * "A layers button on the map"): the radar, the satellite picture, the
 * SIGMETs and G-AIRMETs, the pilot reports, each on or off, and the winds
 * aloft at an altitude picked from a menu (discrete altitudes, not a
 * slider). Kept on this device (lib/map/weatherLayers).
 */
export default function WeatherSettings() {
  const { radar, satellite, areas, pireps, winds, set } = useWeatherLayers();
  const windsLabel = WINDS.find(w => w.value === winds)?.label ?? "Off";
  return (
    <ListGroup title="Weather">
      <ListRow title="Radar">
        <TogglePill pressed={radar} onPressedChange={on => set({ radar: on })} icon={<Radar />} label="Show" testId="weather-radar-toggle" />
      </ListRow>
      <ListRow title="Satellite">
        <TogglePill pressed={satellite} onPressedChange={on => set({ satellite: on })} icon={<Satellite />} label="Show" testId="weather-satellite-toggle" />
      </ListRow>
      <ListRow title="AIRMETs and SIGMETs">
        <TogglePill pressed={areas} onPressedChange={on => set({ areas: on })} icon={<CloudLightning />} label="Show" testId="weather-areas-toggle" />
      </ListRow>
      <ListRow title="PIREPs">
        <TogglePill pressed={pireps} onPressedChange={on => set({ pireps: on })} icon={pireps ? <Eye /> : <EyeOff />} label="Show" testId="weather-pireps-toggle" />
      </ListRow>
      <ListRow title="Winds aloft">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button" aria-label={`Winds aloft: ${windsLabel}`} data-testid="weather-winds"
              className={cn("relative flex h-8 items-center gap-0.5 rounded-full bg-foreground/8 px-2.5 font-semibold text-tint outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
            >
              {windsLabel}
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={String(winds)} onValueChange={v => set({ winds: (v === "off" || v === "plan" ? v : Number(v)) as WindsAt })}>
              {WINDS.map(w => <DropdownMenuRadioItem key={w.value} value={String(w.value)} data-testid={`weather-winds-${w.value}`}>{w.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ListRow>
    </ListGroup>
  );
}
