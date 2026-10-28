import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { numberOrNull, optionalHours, pastDay, requiredPastDay, textOrNull, z } from "../../lib/formSchema";
import { toast } from "sonner";
import { Info, Plus, Route } from "lucide-react";
import EmptyState from "../../components/EmptyState";
import FieldHit from "../../components/FieldHit";
import RowField from "../../components/RowField";
import { invalidProps } from "../../lib/fieldError";
import IconButton from "../../components/IconButton";
import { cn } from "cn";
import { planHrefOf } from "../../lib/flightLink";
import { routeName } from "../../lib/identSchema";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../components/ui/input-group";
import { Spinner } from "../../components/ui/spinner";
import PullDown from "../../components/PullDown";
import { ListChoices, ListGroup, ListRow } from "../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../components/ResponsivePopover";
import { useConfirm } from "../../components/useConfirm";
import { ConsolePages, PageRow } from "../../components/ConsolePages";
import FlightPage from "./FlightPage";
import ChecklistPage from "./ChecklistPage";
import SquawksPage from "./SquawksPage";
import { aircraftKey, choiceOf } from "../../lib/aircraftChoice";
import { api } from "../../lib/api/client";
import type { Aircraft, AircraftRequest, FlightSummary, InspectionsRequest, VorCheckRequest } from "../../lib/api/types";
import { CRUISE_REFERENCE_FT } from "../../lib/performance";
import { usePreferences } from "../../lib/preferences";
import { TEXT } from "../../lib/text";
import { altFt, feet, nm } from "../../lib/units";
import { LEVEL_TONE, riskLine, type RiskLevel } from "../../lib/frat";
import { localDay } from "../../lib/clock";
import { FINDING_TONE } from "../../lib/status";
import { EditToggle, ListPageHead, RemoveMinus } from "../../components/Favorites";
import { aircraftListQuery, aircraftProfilesQuery, flightsQuery } from "../../lib/queryClient";
import QueryState from "../../components/QueryState";
import { SwipeToDelete } from "../../components/SwipeToDelete";

// Mirrors springboot-app's own AircraftRequest validation
// (@NotBlank/@Positive in dto/AircraftRequest.java) so a bad value is
// caught before the round trip, not just after. Fields stay strings
// through validation (matching what a plain <input> actually holds)
// -- the numeric conversion happens once, building the request body in
// onSubmit below, rather than fighting react-hook-form's generics over
// a coerced form-value type.
const positiveNumber = (label: string) => z.string().trim().refine(
  value => Number.isFinite(Number(value)) && Number(value) > 0,
  `${label} must be a positive number`,
);
/** Blank, or a positive number: a figure the owner may leave unsaid. */
const optionalPositiveNumber = (label: string) => z.string().trim().refine(
  value => value === "" || (Number.isFinite(Number(value)) && Number(value) > 0),
  `${label} must be a positive number`,
);
/** Blank, or a power a cruise table has: 40 to 100 percent, the
 *  server's limits and the planner's. */
const optionalPercent = (label: string) => z.string().trim().refine(
  value => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 40 && Number(value) <= 100),
  `${label} must be between 40 and 100%`,
);
/** A form field as the request carries it: blank is null. */
const orNull = (value: string) => (value.trim() ? Number(value) : null);

const aircraftSchema = z.object({
  // The server's limits, which are the columns': longer was refused there
  // as though it were a tail number already on file.
  tailNumber: z.string().trim().min(1, "Tail number is required").max(16, "At most 16 characters"),
  typeDesignator: z.string().trim().min(1, "Type designator is required").max(16, "At most 16 characters"),
  cruiseTasKt: positiveNumber("Cruise speed"),
  fuelBurnGph: positiveNumber("Cruise fuel burn"),
  // Optional: blank flies the cruise figures at the type's own power.
  cruisePowerPct: optionalPercent("Cruise power"),
  // Optional: blank climbs at the planner's book figures for the type.
  climbTasKt: optionalPositiveNumber("Climb speed"),
  climbFuelBurnGph: optionalPositiveNumber("Climb fuel burn"),
  // Optional: blank means the owner has not said, and the nav log then
  // makes no fuel check rather than a wrong one.
  usableFuelGal: optionalPositiveNumber("Usable fuel"),
  // Its flight plan's items, each optional (AIM Appendix 4): 10a's
  // equipment and 10b's surveillance are letters and figures (TBL 4-2's
  // E1 and J1 among them), at most 40 and 20 (TBL 4-3); item 19's colour
  // and markings plain words.
  equipment: z.string().trim().regex(/^[A-Za-z0-9]{0,40}$/, "Letters and figures, as SDFGRY"),
  surveillance: z.string().trim().regex(/^[A-Za-z0-9]{0,20}$/, "Letters and figures, as B1"),
  colour: z.string().trim().max(40, "At most 40 characters"),
});
type AircraftFormValues = z.infer<typeof aircraftSchema>;
const EMPTY_AIRCRAFT_FORM: AircraftFormValues = {
  tailNumber: "", typeDesignator: "", cruiseTasKt: "", fuelBurnGph: "", cruisePowerPct: "", climbTasKt: "",
  climbFuelBurnGph: "", usableFuelGal: "", equipment: "", surveillance: "", colour: "",
};

/** A signed-in pilot's own airplanes -- the one the nav log flies
 *  ticked, and a tap on another flies that one, as iOS lists Wi-Fi
 *  networks; the ⓘ at a row's end opens its figures to edit (the same
 *  form as a new one's), and delete. The picker under the route offers
 *  the same choice. The Library's (PilotPanel), shown only to someone
 *  signed in: it says once, for all three, what signing in keeps. */
const VOR_CHECKS: { value: VorCheckRequest["kind"]; label: string; limit: number }[] = [
  { value: "VOT", label: "VOT", limit: 4 },
  { value: "REPAIR_STATION", label: "Repair station signal", limit: 4 },
  { value: "GROUND", label: "Ground checkpoint", limit: 4 },
  { value: "AIRBORNE", label: "Airborne checkpoint", limit: 6 },
  { value: "RADIAL", label: "Airway radial in flight", limit: 6 },
  { value: "DUAL", label: "Dual receivers", limit: 4 },
];

// The server's own limits on a VOR check (VorCheckRequest.java): the day
// not ahead, the place at most 80 characters, and an error within 30° --
// a typing slip past that, not a reading; 91.171's own 4° and 6° are
// the check's standing, said once it is recorded, never refused.
const vorCheckSchema = z.object({
  checkedOn: requiredPastDay("The day is required"),
  kind: z.enum(["VOT", "REPAIR_STATION", "GROUND", "AIRBORNE", "RADIAL", "DUAL"]),
  place: z.string().trim().max(80, "At most 80 characters"),
  errorDeg: z.string().trim().min(1, "The error is required")
    .refine(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 30, "Within 30° either way"),
});
type VorCheckValues = z.infer<typeof vorCheckSchema>;

/**
 * The airplane's VOR check for IFR (14 CFR 91.171): the last one and how
 * long it is good for -- 30 days, its error within its kind's limit (4
 * degrees at a VOT, a repair station's signal, a ground checkpoint or
 * between two receivers; 6 at an airborne checkpoint or on a radial) --
 * and the next recorded with the date, kind, place and error 91.171(d)
 * asks for. Its own Record, apart from the airplane's Save.
 */
function VorCheckGroup({ aircraft }: { aircraft: Aircraft }) {
  const queryClient = useQueryClient();
  const id = useId();
  const { register, control, handleSubmit, formState: { errors } } = useForm<VorCheckValues>({
    resolver: zodResolver(vorCheckSchema),
    defaultValues: { checkedOn: localDay(), kind: "VOT", place: "", errorDeg: "0" },
  });
  const record = useMutation({
    mutationFn: (request: VorCheckRequest) => api.aircraft.vorCheck(aircraft.id, request),
    onSuccess: () => { toast.success("VOR Check Saved"); void queryClient.invalidateQueries({ queryKey: ["aircraft"] }); },
  });
  // Inside the airplane's own form, so its Record is a button, not a
  // second <form>: handleSubmit checks the fields, then sends them, or
  // focuses the first one wrong.
  const onRecord = handleSubmit(values => record.mutate({
    checkedOn: values.checkedOn, kind: values.kind, place: values.place.trim() || null, errorDeg: Number(values.errorDeg),
  }));
  const last = aircraft.vorCheck;
  const today = localDay();
  const good = !!last && last.withinLimit && last.goodThrough >= today;
  return (
    // For IFR by VOR: every 30 days, within 4° at a VOT, a repair station's
    // signal, a ground checkpoint or between two receivers, within 6° at an
    // airborne checkpoint or on an airway's radial (14 CFR 91.171).
    <ListGroup title="VOR check">
      <ListRow
        title="Last check"
        description={last ? `${last.checkedOn} · ${VOR_CHECKS.find(k => k.value === last.kind)?.label ?? last.kind}${last.place ? ` · ${last.place}` : ""} · ${last.errorDeg}°` : "None recorded"}
        value={!last ? undefined : (
          <span className={cn(good ? FINDING_TONE.ok : FINDING_TONE.stop)} data-testid="vor-check-standing">
            {!last.withinLimit ? `Over ${last.limitDeg}°` : good ? `To ${last.goodThrough}` : `Ended ${last.goodThrough}`}
          </span>
        )}
      />
      <ListRow id={`${id}-on`} title="Checked on">
        <RowField id={`${id}-on`} error={errors.checkedOn?.message}>
          <FieldHit htmlFor={`${id}-on`}><Input id={`${id}-on`} type="date" className="h-8 w-40" max={today} {...register("checkedOn")}
            {...invalidProps(`${id}-on`, errors.checkedOn?.message)} aria-label="VOR check date" data-testid="vor-check-date" /></FieldHit>
        </RowField>
      </ListRow>
      <ListRow title="How">
        <Controller control={control} name="kind" render={({ field }) => (
          <PullDown
            label="How the VOR was checked" value={field.value} testId="vor-check-kind"
            options={VOR_CHECKS.map(k => ({ value: k.value, label: `${k.label} (±${k.limit}°)` }))}
            onChange={field.onChange}
          />
        )} />
      </ListRow>
      <ListRow id={`${id}-place`} title="Where">
        <RowField id={`${id}-place`} error={errors.place?.message}>
          <FieldHit htmlFor={`${id}-place`}><Input id={`${id}-place`} className="h-8 w-40 text-right" placeholder="KDLH VOT" {...register("place")}
            {...invalidProps(`${id}-place`, errors.place?.message)} aria-label="Where the VOR was checked" /></FieldHit>
        </RowField>
      </ListRow>
      <ListRow id={`${id}-error`} title="Bearing error">
        <RowField id={`${id}-error`} error={errors.errorDeg?.message}>
          <FieldHit htmlFor={`${id}-error`}><Input id={`${id}-error`} type="number" inputMode="decimal" step="any" className="h-8 w-24 text-right" {...register("errorDeg")}
            {...invalidProps(`${id}-error`, errors.errorDeg?.message)} aria-label="Bearing error in degrees" data-testid="vor-check-error" /></FieldHit>
        </RowField>
      </ListRow>
      <ListRow
        title={<span className="font-medium text-tint">Record check</span>}
        onClick={() => void onRecord()} disabled={record.isPending} data-testid="vor-check-record"
      />
    </ListGroup>
  );
}

/** The inspections' dates, each with the rule that asks for it. */
const DATED: { key: "annualOn" | "staticCheckOn" | "transponderCheckOn" | "eltInspectedOn"; through: "annualGoodThrough" | "staticCheckGoodThrough" | "transponderCheckGoodThrough" | "eltInspectionGoodThrough"; title: string; rule: string }[] = [
  { key: "annualOn", through: "annualGoodThrough", title: "Annual", rule: "12 calendar months, 14 CFR 91.409(a)" },
  { key: "staticCheckOn", through: "staticCheckGoodThrough", title: "Altimeter and static", rule: "24 calendar months, for IFR, 91.411" },
  { key: "transponderCheckOn", through: "transponderCheckGoodThrough", title: "Transponder", rule: "24 calendar months, 91.413" },
  { key: "eltInspectedOn", through: "eltInspectionGoodThrough", title: "ELT inspection", rule: "12 calendar months, 91.207(d)" },
];

// As the server checks them (InspectionsRequest.java): each may be left
// blank; the days done not ahead of today, and the hours not negative.
// The ELT battery's day is the one marked on it (91.207(c)), so may be.
const inspectionsSchema = z.object({
  annualOn: pastDay, staticCheckOn: pastDay, transponderCheckOn: pastDay, eltInspectedOn: pastDay,
  eltBatteryDueOn: z.string(),
  hundredHourAtHours: optionalHours, hoursNow: optionalHours,
});
type InspectionsValues = z.infer<typeof inspectionsSchema>;

/** How a last good day stands today: in green to it, red past it. */
function Standing({ through, testId }: { through: string | null | undefined; testId: string }) {
  if (!through) return null;
  const today = localDay();
  const good = through >= today;
  return (
    <span className={cn(good ? FINDING_TONE.ok : FINDING_TONE.stop)} data-testid={testId}>
      {good ? `To ${through}` : `Past due since ${through}`}
    </span>
  );
}

/**
 * The airplane's inspections and tests, as its owner records them from its
 * maintenance records, each with the last day it is good for (the webapp
 * works it out by the rule's calendar months) -- what the risk assessment
 * reads for whether it may be flown (lib/airworthiness). Saved together.
 */
function InspectionsGroup({ aircraft }: { aircraft: Aircraft }) {
  const queryClient = useQueryClient();
  const id = useId();
  const recorded = aircraft.inspections;
  const { register, handleSubmit, formState: { errors } } = useForm<InspectionsValues>({
    resolver: zodResolver(inspectionsSchema),
    defaultValues: {
      annualOn: recorded?.annualOn ?? "", staticCheckOn: recorded?.staticCheckOn ?? "",
      transponderCheckOn: recorded?.transponderCheckOn ?? "", eltInspectedOn: recorded?.eltInspectedOn ?? "",
      eltBatteryDueOn: recorded?.eltBatteryDueOn ?? "",
      hundredHourAtHours: recorded?.hundredHourAtHours == null ? "" : String(recorded.hundredHourAtHours),
      hoursNow: recorded?.hoursNow == null ? "" : String(recorded.hoursNow),
    },
  });
  const save = useMutation({
    mutationFn: (request: InspectionsRequest) => api.aircraft.inspections(aircraft.id, request),
    onSuccess: () => { toast.success("Inspections Saved"); void queryClient.invalidateQueries({ queryKey: ["aircraft"] }); },
  });
  // A button inside the airplane's form, as the VOR check's Record is.
  const onSave = handleSubmit(values => save.mutate({
    annualOn: textOrNull(values.annualOn), staticCheckOn: textOrNull(values.staticCheckOn),
    transponderCheckOn: textOrNull(values.transponderCheckOn), eltInspectedOn: textOrNull(values.eltInspectedOn),
    eltBatteryDueOn: textOrNull(values.eltBatteryDueOn),
    hundredHourAtHours: numberOrNull(values.hundredHourAtHours), hoursNow: numberOrNull(values.hoursNow),
  }));
  const today = localDay();
  const due = recorded?.hundredHourDueAtHours;
  return (
    // From the airplane's maintenance records. The 100-hour is owed only when
    // it is flown for hire, or for instruction in it by the one who provides
    // it (91.409(b)); the ELT's are not owed on a training flight within 50
    // nm of its departure (91.207(f)).
    <ListGroup title="Inspections">
      {DATED.map(d => (
        <ListRow
          key={d.key} id={`${id}-${d.key}`} title={d.title}
          description={<>{d.rule}{recorded?.[d.through] && <> · <Standing through={recorded[d.through]} testId={`inspection-${d.key}`} /></>}</>}
        >
          <RowField id={`${id}-${d.key}`} error={errors[d.key]?.message}>
            <FieldHit htmlFor={`${id}-${d.key}`}><Input
              id={`${id}-${d.key}`} type="date" className="h-8 w-40" max={today} {...register(d.key)}
              {...invalidProps(`${id}-${d.key}`, errors[d.key]?.message)} data-testid={`inspection-${d.key}-date`}
            /></FieldHit>
          </RowField>
        </ListRow>
      ))}
      <ListRow
        id={`${id}-battery`} title="ELT battery replace by"
        description={<>As marked on the transmitter, 91.207(c){recorded?.eltBatteryDueOn && (
          <> · <span className={cn(recorded.eltBatteryDueOn > today ? FINDING_TONE.ok : FINDING_TONE.stop)} data-testid="inspection-eltBattery">
            {recorded.eltBatteryDueOn > today ? `By ${recorded.eltBatteryDueOn}` : `Due since ${recorded.eltBatteryDueOn}`}
          </span></>
        )}</>}
      >
        <FieldHit htmlFor={`${id}-battery`}><Input
          id={`${id}-battery`} type="date" className="h-8 w-40" {...register("eltBatteryDueOn")} data-testid="inspection-eltBattery-date"
        /></FieldHit>
      </ListRow>
      <ListRow
        id={`${id}-at`} title="Hours at last 100-hour"
        description={due != null ? <>Due at {due.toFixed(1)} h{recorded?.hoursNow != null && (
          <span className={cn(recorded.hoursNow < due ? FINDING_TONE.ok : FINDING_TONE.stop)} data-testid="inspection-hundredHour">
            {recorded.hoursNow < due ? `, ${(due - recorded.hoursNow).toFixed(1)} h to go` : ", due now"}
          </span>
        )}</> : "Time in service, at the last annual or 100-hour"}
      >
        <RowField id={`${id}-at`} error={errors.hundredHourAtHours?.message}>
          <FieldHit htmlFor={`${id}-at`}><Input
            id={`${id}-at`} type="number" inputMode="decimal" step="any" min={0} className="h-8 w-28 text-right"
            {...register("hundredHourAtHours")} {...invalidProps(`${id}-at`, errors.hundredHourAtHours?.message)}
            data-testid="inspection-hundredHourAt"
          /></FieldHit>
        </RowField>
      </ListRow>
      <ListRow id={`${id}-now`} title="Hours now">
        <RowField id={`${id}-now`} error={errors.hoursNow?.message}>
          <FieldHit htmlFor={`${id}-now`}><Input
            id={`${id}-now`} type="number" inputMode="decimal" step="any" min={0} className="h-8 w-28 text-right"
            {...register("hoursNow")} {...invalidProps(`${id}-now`, errors.hoursNow?.message)}
            data-testid="inspection-hoursNow"
          /></FieldHit>
        </RowField>
      </ListRow>
      <ListRow
        title={<span className="font-medium text-tint">Save inspections</span>}
        onClick={() => void onSave()} disabled={save.isPending} data-testid="inspections-save"
      />
    </ListGroup>
  );
}

export function AircraftPanel() {
  const queryClient = useQueryClient();
  const { data: list, isLoading } = useQuery(aircraftListQuery);
  // Which the nav log flies, remembered per browser, and the stock
  // profiles a pilot's own rides on (PlanWorkspace asks the same).
  const flying = usePreferences(s => s.aircraft);
  const fly = usePreferences(s => s.setAircraft);
  const { data: profiles } = useQuery(aircraftProfilesQuery);
  const [editingId, setEditingId] = useState<number | null>(null);
  // The form is behind the list's New aircraft row: open for a new
  // airplane from there, or for one of the rows from its ⓘ. Closed
  // again when the save lands, on Cancel, or from the same row.
  const [adding, setAdding] = useState(false);
  const formOpen = adding || editingId !== null;
  const formId = useId();
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<AircraftFormValues>({
    resolver: zodResolver(aircraftSchema),
    defaultValues: EMPTY_AIRCRAFT_FORM,
  });

  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
    reset(EMPTY_AIRCRAFT_FORM);
  };

  // Which airplane a save is for travels with it, the way `remove`'s id
  // does: it used to be read from the form's state when the save
  // finished, so an add still in flight when Edit was clicked on another
  // row toasted "updated" and wiped the form just opened.
  const save = useMutation({
    mutationFn: ({ id, request }: { id: number | null; request: AircraftRequest }) =>
      id ? api.aircraft.update(id, request) : api.aircraft.add(request),
    // The only other feedback a save gets is a row quietly changing in
    // a table below the form -- easy to miss with your eyes still on
    // the inputs you just submitted, unlike Plan/Label's own toasts
    // (usePageStatus), which confirm something already big and visible
    // (a route, a rating). This is the one place in the app a genuine
    // list-editing success has nothing else to announce it.
    onSuccess: (_data, { id }) => {
      toast.success(id ? "Airplane Saved" : "Airplane Added");
      // Cleared only while it still shows what was saved.
      if (editingId === id) cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.aircraft.remove(id),
    onSuccess: (_data, id) => {
      toast.success("Airplane Deleted");
      if (editingId === id) cancelEdit();
      void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
    },
  });

  const edit = (a: Aircraft) => {
    setEditingId(a.id);
    reset({
      tailNumber: a.tailNumber, typeDesignator: a.typeDesignator,
      cruiseTasKt: String(a.cruiseTasKt), fuelBurnGph: String(a.fuelBurnGph),
      cruisePowerPct: a.cruisePowerPct == null ? "" : String(a.cruisePowerPct),
      climbTasKt: a.climbTasKt == null ? "" : String(a.climbTasKt),
      climbFuelBurnGph: a.climbFuelBurnGph == null ? "" : String(a.climbFuelBurnGph),
      usableFuelGal: a.usableFuelGal == null ? "" : String(a.usableFuelGal),
      equipment: a.equipment ?? "", surveillance: a.surveillance ?? "", colour: a.colour ?? "",
    });
  };

  const onSubmit = (values: AircraftFormValues) => save.mutate({ id: editingId, request: {
    tailNumber: values.tailNumber.trim(), typeDesignator: values.typeDesignator.trim(),
    cruiseTasKt: Number(values.cruiseTasKt), fuelBurnGph: Number(values.fuelBurnGph),
    cruisePowerPct: orNull(values.cruisePowerPct),
    climbTasKt: orNull(values.climbTasKt), climbFuelBurnGph: orNull(values.climbFuelBurnGph),
    usableFuelGal: orNull(values.usableFuelGal),
    equipment: values.equipment.trim() || null, surveillance: values.surveillance.trim() || null,
    colour: values.colour.trim() || null,
  } });

  // Delete is in the airplane's own form, asked first: it was a red
  // word on every row, beside Edit.
  const editing = list?.find(a => a.id === editingId) ?? null;
  const [askDelete, deleteDialog] = useConfirm({
    title: `Delete ${editing?.tailNumber ?? "this airplane"}?`,
    description: "It goes from your airplanes and from the nav log's picker. This can't be undone.",
    confirmLabel: "Delete airplane",
    destructive: true,
    onConfirm: () => { if (editingId !== null) remove.mutate(editingId); },
  });
  const formElementId = `${formId}-form`;
  const problem = (message?: string) => (message ? <span className="text-destructive">{message}</span> : undefined);

  // The airplane's checklist, a page of the form's (ChecklistPage).
  const checklistPages = editing
    ? {
      [`checklist-${editing.id}`]: { title: `${editing.tailNumber} checklist`, content: <ChecklistPage aircraft={editing} /> },
      [`squawks-${editing.id}`]: { title: `${editing.tailNumber} squawks`, content: <SquawksPage aircraft={editing} /> },
    }
    : {};

  // The tab says what this is: no heading over the list, only the
  // group's own, as an iOS page under a segmented control has.
  return (
    <ConsolePages back="Airplanes" pages={checklistPages}>
    <section aria-label="Airplanes">
      {isLoading ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching your airplanes…</p>
      ) : (
        // A grouped list at every width, as iOS lists things: a row per
        // airplane, and New aircraft as the last row. It was a card per
        // airplane with an Edit and a Delete on each on a phone, a table
        // from md up, and a small plus beside the heading as the only way
        // to add one; then a row that opened the form, and which one the
        // nav log flew was said only under the route.
        <ResponsivePopover open={formOpen} onOpenChange={open => (open ? setAdding(true) : cancelEdit())}>
          {/* The one flown a radio group's choice (ListChoices): arrow keys
              between the airplanes, VoiceOver's "selected", and iOS's tick. */}
          <ListChoices
            label="Your airplanes" value={aircraftKey(flying)}
            onChange={key => {
              const a = list?.find(x => `mine:${x.id}` === key);
              if (a) fly(choiceOf(a, profiles ?? []));
            }}
          >
          <ListGroup title="Your airplanes">
            {/* Which the nav log flies where it is none of these, said in its
                place as a row: the one ticked otherwise. */}
            {!!list?.length && flying.aircraftId == null && (
              <ListRow muted title={<>Flying the stock {flying.label}</>} data-testid="aircraft-stock" />
            )}
            {(list ?? []).map(a => {
              return (
                <div key={a.id} className="flex items-center" data-aircraft-row>
                  {/* The tick before the name, its place kept when it is
                      elsewhere so the names line up, as Wi-Fi's are. */}
                  <ListRow
                    className="min-w-0 flex-1" radio={`mine:${a.id}`}
                    title={<><span className="font-mono font-semibold">{a.tailNumber}</span> <span className="text-muted-foreground">{a.typeDesignator}</span></>}
                    description={`Cruise ${a.cruiseTasKt} kt, ${a.fuelBurnGph} gph${a.cruisePowerPct != null ? ` at ${a.cruisePowerPct}%` : ""}${
                      a.usableFuelGal != null ? ` · ${a.usableFuelGal} gal usable` : ""}`}
                  />
                  <IconButton
                    label={`Edit ${a.tailNumber}`} onClick={() => edit(a)} className="mr-1.5 shrink-0 text-tint"
                    // Not "outside" the open form: tapped with it open, the
                    // form switches to this airplane (see onInteractOutside).
                    data-aircraft-edit
                  >
                    <Info className="size-5" />
                  </IconButton>
                </div>
              );
            })}
            <ResponsivePopoverTrigger asChild>
              <ListRow
                title={<span className="flex items-center gap-2 font-medium"><Plus className="size-4" />New airplane</span>}
                data-testid="new-aircraft-button"
              />
            </ResponsivePopoverTrigger>
          </ListGroup>
          </ListChoices>
          {/* On a phone a sheet from the navigation bar's edge, over the
              console's own; from md up a popover by the rows. Cancel and
              Add (or Save) in its title row, as an iOS form sheet has
              them; each field a row, its label at the start and the
              field at the end, units inside. */}
          <ResponsivePopoverContent
            title={editingId ? "Edit airplane" : "New airplane"}
            align="start" className="w-80"
            leading={<Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={cancelEdit}>Cancel</Button>}
            action={(
              // A spinner while it saves: disabled alone looked like
              // nothing was happening. The name stays the words.
              <Button
                type="submit" form={formElementId} size="sm" className="-mr-1"
                disabled={save.isPending} aria-busy={save.isPending}
                aria-label={editingId ? "Save changes" : "Add airplane"}
              >
                {save.isPending && <Spinner role="presentation" aria-label={undefined} aria-hidden />}
                {editingId ? "Save" : "Add"}
              </Button>
            )}
            // A row, tapped while the form is open, is not "outside": it
            // switches the form to that airplane, where the stock
            // dismissal would have closed it on the press and reopened it
            // empty on the click.
            onInteractOutside={e => { if ((e.target as Element | null)?.closest?.("[data-aircraft-edit]")) e.preventDefault(); }}
          >
            <form id={formElementId} className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {/* What the airplane is, then its speeds and fuel burns --
                  climb and cruise, a row each under the group's heading
                  -- and the power the cruise is at, then its tanks. Each
                  field keeps its label and unit while it is typed in; the
                  placeholders are examples. The accessible names say the
                  phase and the units in full. The identifiers are
                  capitals and never autocorrected. */}
              <ListGroup>
                <ListRow id={`${formId}-tail`} title="Tail number" description={problem(errors.tailNumber?.message)}>
                  <FieldHit htmlFor={`${formId}-tail`}><Input
                    id={`${formId}-tail`} {...register("tailNumber")} placeholder="N12345" className="h-8 w-32 text-right"
                    aria-label="Tail number" aria-invalid={!!errors.tailNumber}
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  /></FieldHit>
                </ListRow>
                <ListRow id={`${formId}-type`} title="Type" description={problem(errors.typeDesignator?.message)}>
                  <FieldHit htmlFor={`${formId}-type`}><Input
                    id={`${formId}-type`} {...register("typeDesignator")} placeholder="C172" className="h-8 w-32 text-right"
                    aria-label="Type designator" aria-invalid={!!errors.typeDesignator}
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  /></FieldHit>
                </ListRow>
              </ListGroup>
              <ListGroup title="True airspeed">
                <NumberRow
                  id={`${formId}-climb-tas`} title="Climb" unit="kt" placeholder="74" name="Climb TAS in knots"
                  field={register("climbTasKt")} error={errors.climbTasKt?.message}
                />
                <NumberRow
                  id={`${formId}-tas`} title="Cruise" unit="kt" placeholder="110" name="Cruise TAS in knots"
                  field={register("cruiseTasKt")} error={errors.cruiseTasKt?.message}
                />
              </ListGroup>
              {/* Climb is optional: left blank, the nav log climbs at the type's book figures. */}
              <ListGroup title="Fuel burn">
                <NumberRow
                  id={`${formId}-climb-burn`} title="Climb" unit="gph" placeholder="11" name="Climb fuel burn in gallons per hour"
                  field={register("climbFuelBurnGph")} error={errors.climbFuelBurnGph?.message}
                />
                <NumberRow
                  id={`${formId}-burn`} title="Cruise" unit="gph" placeholder="8.5" name="Cruise fuel burn in gallons per hour"
                  field={register("fuelBurnGph")} error={errors.fuelBurnGph?.message}
                />
              </ListGroup>
              {/* What the cruise figures mean to the planner, said where
                  they are typed: they are the airplane's at this power at
                  the reference altitude, and each leg flies them in its own
                  air (vfr.performance): the handbook cruise table's at this
                  power at the reference altitude on a standard day, which
                  the group's title says. */}
              <ListGroup title={`Cruise figures at ${altFt(CRUISE_REFERENCE_FT)} ft, standard day`}>
                <NumberRow
                  id={`${formId}-power`} title="Cruise power" unit="%" placeholder="65" name="Cruise power in percent"
                  field={register("cruisePowerPct")} error={errors.cruisePowerPct?.message}
                />
              </ListGroup>
              {/* Usable fuel is optional; without it the nav log makes no fuel check. */}
              <ListGroup>
                <NumberRow
                  id={`${formId}-usable`} title="Usable fuel" unit="gal" placeholder="40" name="Usable fuel in gallons"
                  field={register("usableFuelGal")} error={errors.usableFuelGal?.message}
                />
              </ListGroup>
              {/* What its flight plan says of it, which the Brief's form
                  fills in (FAA Form 7233-4, AIM Appendix 4): item 10a, S for
                  VHF radio, VOR and ILS and a letter for each of the rest (G
                  for GNSS); 10b, C for a transponder with Mode C, B1 or U1
                  for ADS-B Out; item 19's colour and markings. Codes are
                  capitals, never autocorrected. */}
              <ListGroup title="Flight plan">
                <ListRow id={`${formId}-equipment`} title="Equipment" description={problem(errors.equipment?.message)}>
                  <FieldHit htmlFor={`${formId}-equipment`}><Input
                    id={`${formId}-equipment`} {...register("equipment")} placeholder="SDFGRY" maxLength={40}
                    className="h-8 w-32 text-right font-mono uppercase"
                    aria-label="Equipment, flight plan item 10a" aria-invalid={!!errors.equipment}
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  /></FieldHit>
                </ListRow>
                <ListRow id={`${formId}-surveillance`} title="Surveillance" description={problem(errors.surveillance?.message)}>
                  <FieldHit htmlFor={`${formId}-surveillance`}><Input
                    id={`${formId}-surveillance`} {...register("surveillance")} placeholder="B1" maxLength={20}
                    className="h-8 w-32 text-right font-mono uppercase"
                    aria-label="Surveillance, flight plan item 10b" aria-invalid={!!errors.surveillance}
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  /></FieldHit>
                </ListRow>
                <ListRow id={`${formId}-colour`} title="Color" description={problem(errors.colour?.message)}>
                  <FieldHit htmlFor={`${formId}-colour`}><Input
                    id={`${formId}-colour`} {...register("colour")} placeholder="White, blue stripe" maxLength={40}
                    className="h-8 w-40 text-right"
                    aria-label="Color and markings, flight plan item 19" aria-invalid={!!errors.colour}
                  /></FieldHit>
                </ListRow>
              </ListGroup>
              {editing && (
                <ListGroup>
                  <PageRow page={`checklist-${editing.id}`} title="Checklist" description="Yours, from its flight manual, to run" />
                  <PageRow
                    page={`squawks-${editing.id}`} title="Squawks" description="What was found, and its fix"
                    value={editing.openSquawks?.length ? `${editing.openSquawks.length} open` : undefined}
                  />
                </ListGroup>
              )}
              {editing && <InspectionsGroup key={editing.id} aircraft={editing} />}
              {editing && <VorCheckGroup aircraft={editing} />}
              {editingId !== null && (
                <ListGroup>
                  <ListRow
                    title={<span className="font-medium text-destructive">Delete airplane</span>}
                    onClick={askDelete} disabled={remove.isPending} data-testid="delete-aircraft-button"
                  />
                </ListGroup>
              )}
            </form>
          </ResponsivePopoverContent>
          {deleteDialog}
        </ResponsivePopover>
      )}
    </section>
    </ConsolePages>
  );
}

/** One of the aircraft form's figures: its label at the start, the
 *  number at the end with its unit inside the field, and what is wrong
 *  with it under the label. `name` is the accessible name, the phase
 *  and the unit in full ("Climb TAS in knots"). */
function NumberRow({ id, title, unit, placeholder, name, field, error }: {
  id: string;
  title: string;
  unit: string;
  placeholder: string;
  name: string;
  field: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <ListRow id={id} title={title} description={error ? <span className="text-destructive">{error}</span> : undefined}>
      <FieldHit htmlFor={id}>
      <InputGroup className="h-8 w-32">
        <InputGroupInput
          id={id} {...field} placeholder={placeholder} className="text-right"
          aria-label={name} inputMode="decimal" aria-invalid={!!error}
        />
        <InputGroupAddon align="inline-end"><InputGroupText>{unit}</InputGroupText></InputGroupAddon>
      </InputGroup>
      </FieldHit>
    </ListRow>
  );
}

/** A signed-in pilot's own filed flights. Filing one happens from the
 *  route's Share menu (Save); here a flight opens
 *  back on the planner (same route and altitude) or is deleted. A
 *  grouped list at every width, as iOS lists things: a tap on a row
 *  opens the flight and puts the console away, and Edit over the list
 *  puts a red minus before each row, which deletes it once asked in
 *  the app's own sheet. It was an Open and a Delete at every row's
 *  end, and before that a card a flight on a phone and a six-column
 *  table from md up. */
export function FlightsPanel({ onBack }: {
  /** Shown as FPL's Saved in full (SavedStrip's title): headed as its
   *  Recents' page is, Back at its left and Edit at its right, at the
   *  owner's notice ("When clicking on See All for Saved it's not giving
   *  option to go back like recents or favorites"). */
  onBack?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const [flightToDelete, setFlightToDelete] = useState<FlightSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const asked = useQuery(flightsQuery);
  const list = asked.data;

  const remove = useMutation({
    mutationFn: (id: number) => api.flights.remove(id),
    onSuccess: () => {
      toast.success("Flight Deleted");
      setFlightToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
    },
  });
  const [askDelete, deleteDialog] = useConfirm({
    title: flightToDelete ? `Delete ${routeName(flightToDelete.departureIdent, flightToDelete.destinationIdent, flightToDelete.stops)}?` : "Delete this flight?",
    description: "The filed flight goes from your flights. This can't be undone.",
    confirmLabel: "Delete flight",
    destructive: true,
    onConfirm: () => { if (flightToDelete) remove.mutate(flightToDelete.id); },
  });

  // A page a flight (FlightPage), opened from its row.
  const pages = Object.fromEntries((list ?? []).map(f => [`flight-${f.id}`, {
    title: routeName(f.departureIdent, f.destinationIdent, f.stops),
    content: <FlightPage summary={f} planHref={planHrefOf(f)} />,
  }]));

  // Every list's Edit (EditToggle), where this was a copy of it.
  const edit = <EditToggle editing={editing} onToggle={() => setEditing(e => !e)} testId="flights-edit" />;
  return (
    <ConsolePages back="Flights" pages={pages}>
      <section aria-label="Flights" className={onBack ? "space-y-3" : undefined}>
        {onBack && (
          <ListPageHead title="Saved" backLabel="Back to FPL" onBack={onBack} action={list?.length ? edit : undefined} testId="saved-page" />
        )}
        {!list ? (
          // Where they could not be fetched, said here with Try again, where
          // the list showed nothing.
          <QueryState query={asked} fetching="Fetching your flights…" failed="Your flights could not be fetched." />
        ) : list.length === 0 ? (
          <EmptyState icon={<Route />} title="No Flights">
            Plan a route and Save it from Share; it is kept here.
          </EmptyState>
        ) : (
          <ListGroup
            title={onBack ? undefined : "Saved flights"}
            action={onBack ? undefined : edit}
          >
            {(list ?? []).map(f => {
              const name = routeName(f.departureIdent, f.destinationIdent, f.stops);
              const row = {
                title: <>
                  <span className="font-mono font-semibold">{name}</span>
                  {f.aircraftTailNumber && <span className="text-muted-foreground"> {f.aircraftTailNumber}</span>}
                </>,
                description: <span className="tabular-nums">
                  {feet(f.cruiseAltitudeFt)}{f.totalDistanceNm != null && ` · ${nm(f.totalDistanceNm)}`} · filed {new Date(f.createdAt).toLocaleDateString()}
                  {/* The risk assessment it was saved with (lib/frat). */}
                  {f.risk && <span className={cn("block", LEVEL_TONE[f.risk.level as RiskLevel])} data-testid="flight-risk">Risk {riskLine(f.risk).toLowerCase()}</span>}
                </span>,
              };
              // Taken off as every kept list's rows are -- a swipe to the
              // left, or Edit's minus bringing out the Delete -- asked first,
              // the flight being the server's (SwipeToDelete, useConfirm).
              return (
                <SwipeToDelete key={f.id} label={`Delete ${name}`} onDelete={() => { setFlightToDelete(f); askDelete(); }}>
                  {editing ? (
                    <ListRow {...row} media={<RemoveMinus label={`Delete ${name}…`} />} />
                  ) : (
                    // Its own page: what was filed, the way back onto the
                    // map, and its debrief.
                    <PageRow page={`flight-${f.id}`} {...row} />
                  )}
                </SwipeToDelete>
              );
            })}
          </ListGroup>
        )}
        {deleteDialog}
      </section>
    </ConsolePages>
  );
}
