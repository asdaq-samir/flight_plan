import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import FieldHit from "../../components/FieldHit";
import RowField from "../../components/RowField";
import { invalidProps } from "../../lib/fieldError";
import { ListGroup, ListRow } from "../../components/GroupedList";
import QueryState from "../../components/QueryState";
import TogglePill from "../../components/TogglePill";
import { Input } from "../../components/ui/input";
import PullDown from "../../components/PullDown";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api/client";
import type { Aircraft, Squawk, SquawkRequest } from "../../lib/api/types";
import { localDay } from "../../lib/clock";
import { requiredPastDay, z } from "../../lib/formSchema";

const today = () => localDay();

/** The kinds of flight a 91.213(d) determination can be made for, in the
 *  rule's order (91.205(b)-(d)). */
const REACHES: { value: NonNullable<SquawkRequest["deferredFor"]> | "none"; label: string }[] = [
  { value: "none", label: "Not deferred" },
  { value: "VFR_DAY", label: "Deferred for VFR by day" },
  { value: "VFR", label: "Deferred for VFR, day and night" },
  { value: "ALL", label: "Deferred for every kind" },
];

// As the server checks a squawk (SquawkRequest.java): what was found said,
// at most 500 characters, on a day not ahead of today; the fix's note at
// most 500 too.
const squawkSchema = z.object({
  text: z.string().trim().min(1, "Say what was found").max(500, "At most 500 characters"),
  reportedOn: requiredPastDay("The day is required"),
  inoperative: z.boolean(),
  deferredFor: z.enum(["none", "VFR_DAY", "VFR", "ALL"]),
});
type SquawkValues = z.infer<typeof squawkSchema>;
const fixSchema = z.object({ note: z.string().trim().max(500, "At most 500 characters") });
type FixValues = z.infer<typeof fixSchema>;

const asRequest = (s: Squawk): SquawkRequest => ({
  reportedOn: s.reportedOn, text: s.text, inoperative: s.inoperative, deferredFor: s.deferredFor ?? null,
  fixedOn: s.fixedOn ?? null, fixNote: s.fixNote ?? null,
});

/**
 * An airplane's squawks (V24): written as they are found, open until
 * fixed. An instrument or equipment that does not work is marked so, with
 * the kinds of flight its 14 CFR 91.213(d) determination covers -- not
 * required for them, removed or deactivated and placarded, no hazard -- as
 * the risk assessment reads it for the pilot's own airplane on the day
 * (lib/airworthiness): inoperative and not deferred for the flight is a
 * no-go. Fixed, with the day and how.
 */
export default function SquawksPage({ aircraft }: { aircraft: Aircraft }) {
  const foundId = useId();
  const queryClient = useQueryClient();
  // Quiet: the page says in place what it could not fetch (QueryState).
  const asked = useQuery({ queryKey: ["squawks", aircraft.id], queryFn: () => api.aircraft.squawks(aircraft.id), meta: { silent: true } });
  const squawks = asked.data;
  const textId = useId();
  const fixId = useId();
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<SquawkValues>({
    resolver: zodResolver(squawkSchema),
    defaultValues: { text: "", reportedOn: today(), inoperative: false, deferredFor: "none" },
  });
  const inoperative = useWatch({ control, name: "inoperative" });
  const fixForm = useForm<FixValues>({ resolver: zodResolver(fixSchema), defaultValues: { note: "" } });
  const [fixing, setFixing] = useState<Squawk | null>(null);
  const startFix = (squawk: Squawk) => { fixForm.reset({ note: "" }); setFixing(squawk); };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["squawks", aircraft.id] });
    // The airplane's open squawks ride with it, for the risk on the day.
    void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
  };
  const add = useMutation({
    mutationFn: (request: SquawkRequest) => api.aircraft.addSquawk(aircraft.id, request),
    // Ready for the next, on the same day.
    onSuccess: (_data, request) => {
      toast.success("Squawk Saved");
      reset({ text: "", reportedOn: request.reportedOn, inoperative: false, deferredFor: "none" });
      refresh();
    },
  });
  const onAdd = handleSubmit(values => add.mutate({
    reportedOn: values.reportedOn, text: values.text.trim(), inoperative: values.inoperative,
    deferredFor: values.inoperative && values.deferredFor !== "none" ? values.deferredFor : null, fixedOn: null, fixNote: null,
  }));
  const save = useMutation({
    mutationFn: ({ id, request }: { id: number; request: SquawkRequest }) => api.aircraft.updateSquawk(aircraft.id, id, request),
    onSuccess: () => { setFixing(null); refresh(); },
  });
  const onFix = fixForm.handleSubmit(values => {
    if (fixing) save.mutate({ id: fixing.id, request: { ...asRequest(fixing), fixedOn: today(), fixNote: values.note.trim() || null } });
  });
  if (!squawks) return <QueryState query={asked} fetching="Fetching the squawks…" failed="The squawks could not be fetched." />;
  const open = squawks.filter(s => !s.fixedOn);
  const fixed = squawks.filter(s => s.fixedOn);
  const standing = (s: Squawk) => !s.inoperative ? undefined
    : s.deferredFor ? REACHES.find(r => r.value === s.deferredFor)!.label : "Inoperative, not deferred";

  return (
    <div className="space-y-4" data-testid="squawks">
      <ListGroup title="Open">
        {open.length === 0 ? <ListRow muted title="None open" />
          : open.map(s => (
            <ListRow
              key={s.id} title={s.text}
              description={[s.reportedOn, standing(s)].filter(Boolean).join(" · ")}
              onClick={() => startFix(s)}
              data-testid="squawk-open"
            />
          ))}
      </ListGroup>
      {fixing && (
        <ListGroup title={`Fix: ${fixing.text}`}>
          <div className="p-2">
            <RowField id={fixId} error={fixForm.formState.errors.note?.message} wide>
              <Textarea
                id={fixId} {...fixForm.register("note")} rows={3} {...invalidProps(fixId, fixForm.formState.errors.note?.message)}
                placeholder="What was done, and by whom" aria-label="The fix" data-testid="squawk-fix-note"
              />
            </RowField>
          </div>
          <ListRow
            title={<span className="font-medium text-tint">Fixed today</span>} disabled={save.isPending} data-testid="squawk-fix"
            onClick={() => void onFix()}
          />
          <ListRow title="Cancel" onClick={() => setFixing(null)} />
        </ListGroup>
      )}
      {/* An instrument or equipment that does not work may be deferred,
          without a minimum equipment list, for the kinds of flight it is not
          required for (91.205, the equipment list, the kinds of operations
          list, an AD), removed or deactivated and placarded INOPERATIVE, by a
          pilot or a mechanic who finds it no hazard (14 CFR 91.213(d)). */}
      <ListGroup title="Write a squawk">
        <div className="p-2">
          <RowField id={textId} error={errors.text?.message} wide>
            <Textarea
              id={textId} {...register("text")} rows={2} maxLength={500} {...invalidProps(textId, errors.text?.message)}
              placeholder="What was found" aria-label="What was found" data-testid="squawk-text"
            />
          </RowField>
        </div>
        <ListRow id={foundId} title="Found on">
          <RowField id={foundId} error={errors.reportedOn?.message}>
            <FieldHit htmlFor={foundId}><Input id={foundId} type="date" className="h-8 w-40" max={today()} aria-label="Found on"
              {...register("reportedOn")} {...invalidProps(foundId, errors.reportedOn?.message)} /></FieldHit>
          </RowField>
        </ListRow>
        <ListRow title="Inoperative equipment">
          <Controller control={control} name="inoperative" render={({ field }) => (
            <TogglePill pressed={field.value} onPressedChange={field.onChange} label="Inoperative" testId="squawk-inoperative" />
          )} />
        </ListRow>
        {inoperative && (
          <ListRow title="91.213(d)">
            <Controller control={control} name="deferredFor" render={({ field }) => (
              <PullDown label="Deferred for" value={field.value} options={REACHES} testId="squawk-deferred" onChange={field.onChange} />
            )} />
          </ListRow>
        )}
        <ListRow
          title={<span className="font-medium text-tint">Write it</span>} onClick={() => void onAdd()}
          disabled={add.isPending} data-testid="squawk-add"
        />
      </ListGroup>
      {fixed.length > 0 && (
        <ListGroup title="Fixed">
          {fixed.map(s => (
            <ListRow key={s.id} title={s.text} description={[`Fixed ${s.fixedOn}`, s.fixNote].filter(Boolean).join(" · ")} />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
