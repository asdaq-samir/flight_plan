import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListGroup, ListRow } from "../../components/GroupedList";
import QueryState from "../../components/QueryState";
import TogglePill from "../../components/TogglePill";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api/client";
import type { Aircraft, Squawk, SquawkRequest } from "../../lib/api/types";
import { localDay } from "../../lib/clock";

const today = () => localDay();

/** The kinds of flight a 91.213(d) determination can be made for, in the
 *  rule's order (91.205(b)-(d)). */
const REACHES: { value: NonNullable<SquawkRequest["deferredFor"]> | "none"; label: string }[] = [
  { value: "none", label: "Not deferred" },
  { value: "VFR_DAY", label: "Deferred for VFR by day" },
  { value: "VFR", label: "Deferred for VFR, day and night" },
  { value: "ALL", label: "Deferred for every kind" },
];

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
  const queryClient = useQueryClient();
  // Quiet: the page says in place what it could not fetch (QueryState).
  const asked = useQuery({ queryKey: ["squawks", aircraft.id], queryFn: () => api.aircraft.squawks(aircraft.id), meta: { silent: true } });
  const squawks = asked.data;
  const [draft, setDraft] = useState<SquawkRequest>({ reportedOn: today(), text: "", inoperative: false, deferredFor: null, fixedOn: null, fixNote: null });
  const [fixing, setFixing] = useState<{ squawk: Squawk; note: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["squawks", aircraft.id] });
    // The airplane's open squawks ride with it, for the risk on the day.
    void queryClient.invalidateQueries({ queryKey: ["aircraft"] });
  };
  const add = useMutation({
    mutationFn: () => api.aircraft.addSquawk(aircraft.id, { ...draft, text: draft.text.trim() }),
    onSuccess: () => { toast.success("Squawk written"); setDraft({ ...draft, text: "", inoperative: false, deferredFor: null }); refresh(); },
  });
  const save = useMutation({
    mutationFn: ({ id, request }: { id: number; request: SquawkRequest }) => api.aircraft.updateSquawk(aircraft.id, id, request),
    onSuccess: () => { setFixing(null); refresh(); },
  });
  if (!squawks) return <QueryState query={asked} fetching="Fetching the squawks…" failed="The squawks could not be fetched." />;
  const open = squawks.filter(s => !s.fixedOn);
  const fixed = squawks.filter(s => s.fixedOn);
  const standing = (s: Squawk) => !s.inoperative ? undefined
    : s.deferredFor ? REACHES.find(r => r.value === s.deferredFor)!.label : "Inoperative, not deferred";

  return (
    <div className="space-y-4" data-testid="squawks">
      <ListGroup title="Open" footer={open.length ? "Tap one to write its fix." : undefined}>
        {open.length === 0 ? <ListRow title={<span className="text-muted-foreground">None open</span>} />
          : open.map(s => (
            <ListRow
              key={s.id} title={s.text}
              description={[s.reportedOn, standing(s)].filter(Boolean).join(" · ")}
              onClick={() => setFixing({ squawk: s, note: "" })}
              data-testid="squawk-open"
            />
          ))}
      </ListGroup>
      {fixing && (
        <ListGroup title={`Fix: ${fixing.squawk.text}`}>
          <div className="p-2">
            <Textarea
              value={fixing.note} onChange={e => setFixing({ ...fixing, note: e.target.value })} rows={3}
              placeholder="What was done, and by whom" aria-label="The fix" data-testid="squawk-fix-note"
            />
          </div>
          <ListRow
            title={<span className="font-medium text-tint">Fixed today</span>} disabled={save.isPending} data-testid="squawk-fix"
            onClick={() => save.mutate({ id: fixing.squawk.id, request: { ...asRequest(fixing.squawk), fixedOn: today(), fixNote: fixing.note || null } })}
          />
          <ListRow title="Cancel" onClick={() => setFixing(null)} />
        </ListGroup>
      )}
      <ListGroup
        title="Write a squawk"
        footer="An instrument or equipment that does not work may be deferred, without a minimum equipment list, for the kinds of flight it is not required for (91.205, the equipment list, the kinds of operations list, an AD), removed or deactivated and placarded INOPERATIVE, by a pilot or a mechanic who finds it no hazard (14 CFR 91.213(d))."
      >
        <div className="p-2">
          <Textarea
            value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} rows={2} maxLength={500}
            placeholder="What was found" aria-label="What was found" data-testid="squawk-text"
          />
        </div>
        <ListRow title="Found on">
          <Input type="date" className="h-8 w-40" value={draft.reportedOn} max={today()} aria-label="Found on"
            onChange={e => setDraft({ ...draft, reportedOn: e.target.value || today() })} />
        </ListRow>
        <ListRow title="Inoperative equipment">
          <TogglePill
            pressed={draft.inoperative} onPressedChange={on => setDraft({ ...draft, inoperative: on, deferredFor: on ? draft.deferredFor : null })}
            label="Inoperative" testId="squawk-inoperative"
          />
        </ListRow>
        {draft.inoperative && (
          <ListRow title="91.213(d)">
            <Select value={draft.deferredFor ?? "none"} onValueChange={v => setDraft({ ...draft, deferredFor: v === "none" ? null : v as SquawkRequest["deferredFor"] })}>
              <SelectTrigger size="sm" aria-label="Deferred for" data-testid="squawk-deferred"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REACHES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </ListRow>
        )}
        <ListRow
          title={<span className="font-medium text-tint">Write it</span>} onClick={() => add.mutate()}
          disabled={!draft.text.trim() || add.isPending} data-testid="squawk-add"
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
