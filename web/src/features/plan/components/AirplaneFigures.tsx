import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { shortName } from "../../../lib/aircraftChoice";
import { api, describeError } from "../../../lib/api/client";
import type { AircraftChoice, HandbookFigures } from "../../../lib/api/types";
import { usePreferences, type TailFigures } from "../../../lib/preferences";
import { aircraftProfilesQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";

/** The figures a pilot may set for their N-number, in the order a
 *  handbook's specifications give them, with their units and the planner's
 *  own bounds (planning-service's PlanQuery). */
const FIELDS: { key: keyof TailFigures; label: string; unit: string; min: number; max: number }[] = [
  { key: "cruiseTasKt", label: "Cruise speed (TAS)", unit: "kt", min: 30, max: 400 },
  { key: "cruisePowerPct", label: "At power", unit: "%", min: 40, max: 100 },
  { key: "fuelBurnGph", label: "Fuel burn", unit: "gal/h", min: 1, max: 100 },
  { key: "usableFuelGal", label: "Usable fuel", unit: "gal", min: 5, max: 500 },
  { key: "climbTasKt", label: "Climb speed (TAS)", unit: "kt", min: 30, max: 300 },
  { key: "climbFuelBurnGph", label: "Climb fuel burn", unit: "gal/h", min: 1, max: 150 },
  { key: "serviceCeilingFt", label: "Service ceiling", unit: "ft", min: 1000, max: 30000 },
];

/** Each figure the handbook reading gives, by the field it fills. */
const READ: { from: keyof HandbookFigures; key: keyof TailFigures }[] = [
  { from: "cruise_tas_kt", key: "cruiseTasKt" }, { from: "cruise_power_pct", key: "cruisePowerPct" },
  { from: "fuel_burn_gph", key: "fuelBurnGph" }, { from: "usable_fuel_gal", key: "usableFuelGal" },
  { from: "climb_tas_kt", key: "climbTasKt" }, { from: "service_ceiling_ft", key: "serviceCeilingFt" },
];

/** A phone's photo as a JPEG at most 1,600 points on its longer side, in
 *  base64: as much as a page's small print needs, a few hundred kilobytes
 *  to send rather than several megabytes. */
async function smaller(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
}

/**
 * The figures the planner flies the airplane on, for the pilot's own
 * N-number, at the owner's ask ("give users a way to change these specs
 * for their n-number as needed"): its type's handbook figures as the
 * planner has them, each one the pilot may set from their own airplane's
 * handbook. Set, they are kept for the N-number on this device (the
 * preferences' tailFigures) and flown on from then on, the type's profile
 * filling what is not set. Only on the card of the N-number flown now.
 */
export function AirplaneFigures({ tail }: { tail: string }) {
  const aircraft = usePreferences(p => p.aircraft);
  const setAircraft = usePreferences(p => p.setAircraft);
  const setTailFigures = usePreferences(p => p.setTailFigures);
  const { data: profiles } = useQuery(aircraftProfilesQuery);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  // A photo of the handbook's page read for the figures, at the owner's ask
  // ("add a way to upload a pic or add a photo of their manual"): what it
  // read filled in for the pilot to check against the page, and the page's
  // own words for each, before anything is saved.
  const photo = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<{ busy: boolean; words: string[]; problem: string | null }>({ busy: false, words: [], problem: null });
  const readPhoto = async (file: File) => {
    setReading({ busy: true, words: [], problem: null });
    try {
      const read = await api.readHandbook(await smaller(file), "image/jpeg");
      if (read.not_a_handbook_page) {
        setReading({ busy: false, words: [], problem: "That photo is not a handbook's figures: take the specifications or cruise performance page." });
        return;
      }
      const found = READ.flatMap(r => {
        const figure = read[r.from] as { value: number; page_words: string } | null | undefined;
        return figure ? [{ key: r.key, value: Math.round(figure.value * 10) / 10, words: figure.page_words }] : [];
      });
      setEditing(e => ({ ...(e ?? {}), ...Object.fromEntries(found.map(f => [f.key, String(f.value)])) }));
      setReading({
        busy: false, words: found.map(f => f.words),
        problem: found.length ? null : "No planning figures were read off that page.",
      });
    } catch (err) {
      setReading({ busy: false, words: [], problem: describeError(err, "The page could not be read") });
    }
  };
  if (shortName(aircraft.label) !== tail.toUpperCase()) return null;
  const stock = profiles?.find(p => p.name === aircraft.profile);
  const shown: Partial<Record<keyof TailFigures, number | undefined>> = {
    cruiseTasKt: aircraft.cruiseTasKt ?? stock?.cruise_tas_kt,
    cruisePowerPct: aircraft.cruisePowerPct,
    fuelBurnGph: aircraft.fuelBurnGph ?? stock?.fuel_burn_gph,
    usableFuelGal: aircraft.usableFuelGal,
    climbTasKt: aircraft.climbTasKt,
    climbFuelBurnGph: aircraft.climbFuelBurnGph,
    serviceCeilingFt: aircraft.serviceCeilingFt ?? stock?.service_ceiling_ft,
  };
  const own = (key: keyof TailFigures) => aircraft[key as keyof AircraftChoice] !== undefined;
  const save = () => {
    if (!editing) return;
    const figures: TailFigures = {};
    for (const f of FIELDS) {
      const n = Number(editing[f.key]);
      if (editing[f.key]?.trim() && Number.isFinite(n) && n >= f.min && n <= f.max) figures[f.key] = n;
    }
    setTailFigures(tail, figures);
    // The airplane with the figures set now alone, its type's for the rest.
    const rest: AircraftChoice = { ...aircraft };
    for (const f of FIELDS) delete rest[f.key];
    setAircraft({ ...rest, ...figures });
    setEditing(null);
  };
  const begin = () => setEditing(Object.fromEntries(FIELDS.map(f => [f.key, own(f.key) ? String(shown[f.key]) : ""])));
  return (
    <ListGroup
      title="Planning figures"
      action={editing ? undefined : <Button type="button" variant="link" size="sm" className="h-auto p-0 text-tint" onClick={begin} data-testid="figures-edit">Edit</Button>}
    >
      {FIELDS.map(f => (
        <ListRow
          key={f.key} title={f.label}
          value={editing ? (
            <span className="flex items-center gap-1.5">
              <Input
                type="text" inputMode="decimal" value={editing[f.key] ?? ""} placeholder={shown[f.key] != null ? String(shown[f.key]) : "—"}
                onChange={e => setEditing({ ...editing, [f.key]: e.target.value.replace(/[^0-9.]/g, "") })}
                aria-label={`${f.label}, ${f.unit}`} className={cn("h-8 w-24 text-right tabular-nums", TEXT.row)} data-testid={`figure-${f.key}`}
              />
              <span className="w-10 text-muted-foreground">{f.unit}</span>
            </span>
          ) : (
            <span className={cn("tabular-nums", own(f.key) ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {shown[f.key] != null ? `${shown[f.key]!.toLocaleString()} ${f.unit}` : "Its type's"}
            </span>
          )}
        />
      ))}
      {editing && (
        <div className="space-y-2 px-4 py-2">
          {(reading.words.length > 0 || reading.problem) && (
            <div className={cn("space-y-0.5", TEXT.detail)} role="status" data-testid="figures-read">
              {reading.problem && <p className="text-destructive">{reading.problem}</p>}
              {reading.words.length > 0 && <p className="font-semibold">Read from the page: check each against it before saving.</p>}
              {reading.words.map(w => <p key={w} className="text-muted-foreground">{w}</p>)}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={photo} type="file" accept="image/*" capture="environment" className="hidden" data-testid="figures-photo-input"
              onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void readPhoto(file); }}
            />
            <Button type="button" variant="outline" size="sm" disabled={reading.busy} onClick={() => photo.current?.click()} data-testid="figures-photo">
              {reading.busy ? "Reading the page…" : "Read from a photo"}
            </Button>
            <span className="flex-1" />
            <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(null); setReading({ busy: false, words: [], problem: null }); }}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} data-testid="figures-save">Save</Button>
          </div>
        </div>
      )}
    </ListGroup>
  );
}
