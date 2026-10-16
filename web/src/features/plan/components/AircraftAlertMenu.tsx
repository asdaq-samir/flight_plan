import { useMemo } from "react";
import { Bell, BellRing } from "lucide-react";
import { cn } from "cn";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { alertsLine, NEAR_AIRPORT_NM, NEAR_ME_DEFAULT_NM, NEAR_ME_NM, type AircraftAlert, type AircraftAlertKind } from "../../../lib/aircraftAlerts";
import { useOwnShip } from "../../../lib/map/ownShip";
import { usePreferences } from "../../../lib/preferences";
import { primeSpeech } from "../../../lib/speech";
import { TEXT } from "../../../lib/text";
import { CardAction } from "./CardAction";
import type { SketchField } from "./TrailSketch";

/** A choice that cannot be made now greyed, as the menu's own items are
 *  (the stock sub-menu's trigger has no look of its own for it). */
const UNAVAILABLE = "data-disabled:pointer-events-none data-disabled:opacity-50";

/** An airport the alert can be about, with where it is. */
type NearField = { ident: string; name: string | null; lat: number; lon: number; label: string };

/**
 * The airplane card's Alert, at the owner's pick ("Just the alert button
 * for all alerts"): a tile that opens what can be told -- "Tell me when
 * N654FL…" takes off (not while it is in the air), lands, comes near own
 * ship (5, 10 or 20 nm) or near an airport (Home, a Favorite, or the
 * fields it left and is bound for) -- each ticked while it waits and
 * untied by a tap, as iOS's menus do. The stock menu (Radix's, shadcn's),
 * its choices of how near and which airport in menus of their own.
 * Watched while the app is open (AircraftAlerts).
 */
export default function AircraftAlertMenu({ hex, name, airborne, from, to }: {
  hex: string;
  /** Its name as the card shows it, said with the alert. */
  name: string;
  airborne: boolean;
  /** The fields it left and is bound for, offered as airports to be near. */
  from: SketchField | null;
  to: SketchField | null;
}) {
  const all = usePreferences(s => s.aircraftAlerts);
  const alerts = useMemo(() => all.filter(a => a.hex === hex), [all, hex]);
  const home = usePreferences(s => s.homeAirport);
  const favorites = usePreferences(s => s.favoriteAirports);
  const fixed = useOwnShip(s => s.enabled && !!s.fix);
  const of = (kind: AircraftAlertKind) => alerts.find(a => a.kind === kind) ?? null;
  const set = (alert: Omit<AircraftAlert, "hex" | "name">) => {
    // The tap lets the phone speak when the alert goes off (lib/speech).
    primeSpeech();
    usePreferences.getState().setAircraftAlert({ hex, name, ...alert });
  };
  const unset = (kind: AircraftAlertKind) => usePreferences.getState().removeAircraftAlert(hex, kind);
  // The airports offered: Home, the Favorites, then the fields of its own
  // flight, each once and only where where it is is known.
  const fields = useMemo<NearField[]>(() => {
    const kept = [home && { ...home, label: `Home · ${home.ident}` }, ...favorites.map(f => ({ ...f, label: f.ident }))]
      .flatMap(a => (a && a.lat !== undefined && a.lon !== undefined
        ? [{ ident: a.ident, name: a.name, lat: a.lat, lon: a.lon, label: a.label }] : []));
    const own = [from && { ...from, label: `${from.ident} · it left` }, to && { ...to, label: `${to.ident} · bound for` }]
      .flatMap(f => (f ? [{ ident: f.ident, name: null, lat: f.lat, lon: f.lon, label: f.label }] : []));
    return [...kept, ...own].filter((f, i, all) => all.findIndex(g => g.ident === f.ident) === i);
  }, [home, favorites, from, to]);
  const nearMe = of("near-me");
  const nearField = of("near-airport");
  const takeoff = of("takeoff");
  const waiting = alerts.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <CardAction
          icon={waiting ? <BellRing /> : <Bell />} label="Alert" filled={waiting} testId="flight-alert"
          spoken={waiting ? `Alert: ${alertsLine(alerts)}` : `Alert for ${name}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72" data-testid="flight-alert-menu">
        <DropdownMenuLabel className={cn("font-normal text-muted-foreground", TEXT.note)}>Tell me when {name}…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={!!takeoff} disabled={airborne && !takeoff} data-testid="flight-alert-takeoff"
          onCheckedChange={on => (on ? set({ kind: "takeoff" }) : unset("takeoff"))}
          // Ticked, the menu stays open, as iOS's does for a choice of several.
          onSelect={event => event.preventDefault()}
        >
          <span className="flex flex-col">
            Takes off
            {airborne && !takeoff && <span className={cn("text-muted-foreground", TEXT.note)}>It is in the air now</span>}
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={!!of("land")} data-testid="flight-alert-land"
          onCheckedChange={on => (on ? set({ kind: "land" }) : unset("land"))}
          onSelect={event => event.preventDefault()}
        >
          Lands
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!fixed && !nearMe} className={UNAVAILABLE} data-testid="flight-alert-near-me">
            <span className="flex min-w-0 flex-1 flex-col">
              Comes near me
              {!fixed && !nearMe && <span className={cn("text-muted-foreground", TEXT.note)}>Your position is off</span>}
            </span>
            <span className="text-muted-foreground">{nearMe ? `${nearMe.nm ?? NEAR_ME_DEFAULT_NM} nm` : "Off"}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={nearMe ? String(nearMe.nm ?? NEAR_ME_DEFAULT_NM) : "off"}
              onValueChange={value => (value === "off" ? unset("near-me") : set({ kind: "near-me", nm: Number(value) }))}
            >
              <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
              {NEAR_ME_NM.map(nm => (
                <DropdownMenuRadioItem key={nm} value={String(nm)} data-testid={`flight-alert-near-me-${nm}`}>{nm} nm</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!fields.length && !nearField} className={UNAVAILABLE} data-testid="flight-alert-near-airport">
            <span className="flex min-w-0 flex-1 flex-col">
              Comes near an airport
              {!fields.length && !nearField && <span className={cn("text-muted-foreground", TEXT.note)}>Add a Home or a Favorite first</span>}
            </span>
            <span className="text-muted-foreground">{nearField?.airport?.ident ?? "Off"}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuLabel className={cn("font-normal text-muted-foreground", TEXT.note)}>Within {NEAR_AIRPORT_NM} nm of</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={nearField?.airport?.ident ?? "off"}
              onValueChange={value => {
                const field = fields.find(f => f.ident === value);
                if (!field) unset("near-airport");
                else set({ kind: "near-airport", airport: { ident: field.ident, name: field.name, lat: field.lat, lon: field.lon } });
              }}
            >
              <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
              {fields.map(field => (
                <DropdownMenuRadioItem key={field.ident} value={field.ident} data-testid={`flight-alert-airport-${field.ident}`}>
                  {field.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
