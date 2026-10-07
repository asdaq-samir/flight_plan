import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CircleMinus, GraduationCap, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ConsolePages, PageRow } from "../../components/ConsolePages";
import IconButton from "../../components/IconButton";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../components/ResponsivePopover";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useConfirm } from "../../components/useConfirm";
import { api } from "../../lib/api/client";
import type { Currency, LogbookEntry, LogbookEntryRequest } from "../../lib/api/types";
import { TEXT } from "../../lib/text";
import CheckridePage from "./CheckridePage";

const day = (iso: string) => format(parseISO(iso), "d MMM yyyy");
const today = () => format(new Date(), "yyyy-MM-dd");

/** "To 19 Dec 2026" in the tint's green, or "Not current" in red. */
function Until({ date, what }: { date: string | null | undefined; what: string }) {
  const current = !!date && date >= today();
  return (
    <span className={cn("tabular-nums", current ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")} data-testid={`currency-${what}`}>
      {!date ? "Not current" : current ? `To ${day(date)}` : `Ended ${day(date)}`}
    </span>
  );
}

/** A date the pilot gives (the flight review's, the medical's expiry),
 *  saved as it changes. */
function DateField({ value, label, onChange, testId }: { value: string | null | undefined; label: string; onChange: (v: string | null) => void; testId: string }) {
  const id = useId();
  return (
    <Input
      id={id} type="date" aria-label={label} value={value ?? ""} className="h-8 w-40" data-testid={testId}
      onChange={e => onChange(e.target.value || null)}
    />
  );
}

const BLANK: LogbookEntryRequest = {
  flownOn: today(), aircraft: "", aircraftType: "", route: "", totalHours: 0, nightHours: 0, crossCountryHours: 0,
  dayLandings: 1, nightLandings: 0, remarks: "",
  dualHours: 0, soloHours: 0, instrumentHours: 0, toweredLandings: 0, distanceNm: 0, longestLegNm: 0,
};

/** One entry's form: a paper logbook's columns. */
function EntryForm({ initial, onSave, saving }: { initial: LogbookEntryRequest; onSave: (r: LogbookEntryRequest) => void; saving: boolean }) {
  const [entry, setEntry] = useState(initial);
  const field = (key: keyof LogbookEntryRequest, label: string, type: "text" | "number" | "date" = "text") => (
    <label className={cn("grid grid-cols-[8rem_1fr] items-center gap-2", TEXT.detail)}>
      <span>{label}</span>
      <Input
        type={type} inputMode={type === "number" ? "decimal" : undefined} step={type === "number" ? "any" : undefined}
        min={type === "number" ? 0 : undefined} className="h-8" data-testid={`logbook-${key}`}
        value={(entry[key] as string | number | null | undefined) ?? ""}
        onChange={e => setEntry({ ...entry, [key]: type === "number" ? Number(e.target.value || 0) : e.target.value })}
      />
    </label>
  );
  return (
    <form className="space-y-2.5" onSubmit={e => { e.preventDefault(); onSave(entry); }}>
      {field("flownOn", "Date", "date")}
      {field("route", "Route")}
      {field("aircraft", "Aircraft")}
      {field("aircraftType", "Type")}
      {field("totalHours", "Total hours", "number")}
      {field("nightHours", "Night hours", "number")}
      {field("crossCountryHours", "Cross-country", "number")}
      {field("dayLandings", "Day landings", "number")}
      {field("nightLandings", "Night landings", "number")}
      {/* What a student's 61.109 experience is counted from: the
          Checkride page. */}
      {field("dualHours", "Dual received", "number")}
      {field("soloHours", "Solo", "number")}
      {field("instrumentHours", "Sim. instrument", "number")}
      {field("toweredLandings", "Towered landings", "number")}
      {field("distanceNm", "Distance (nm)", "number")}
      {field("longestLegNm", "Longest leg (nm)", "number")}
      {field("remarks", "Remarks")}
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" disabled={saving || !entry.flownOn} data-testid="logbook-save">Save</Button>
      </div>
    </form>
  );
}

/**
 * The pilot's logbook and their currency, the Library's Logbook:
 * where they stand first -- passengers by day and at night (14 CFR
 * 61.57), the flight review (61.56) and the medical, with the two dates
 * they give -- then the totals and the flights, newest first. Add opens
 * the entry's form,
 * filled in with the airplane picked for planning; a row opens it to
 * change; Edit takes one out.
 */
export function LogbookPanel({ aircraft }: { aircraft?: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<LogbookEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [toDelete, setToDelete] = useState<LogbookEntry | null>(null);
  const { data: entries, isLoading } = useQuery({ queryKey: ["logbook"], queryFn: api.logbook.list });
  const { data: currency } = useQuery({ queryKey: ["currency"], queryFn: api.logbook.currency });
  const { data: training } = useQuery({ queryKey: ["training"], queryFn: api.training.get });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["logbook"] });
    void queryClient.invalidateQueries({ queryKey: ["currency"] });
    void queryClient.invalidateQueries({ queryKey: ["training"] });
  };
  const save = useMutation({
    mutationFn: ({ id, entry }: { id?: number; entry: LogbookEntryRequest }) => (id ? api.logbook.update(id, entry) : api.logbook.add(entry)),
    onSuccess: () => { toast.success("Logged"); setAdding(false); setChanging(null); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.logbook.remove(id), onSuccess: () => { setToDelete(null); refresh(); } });
  const dates = useMutation({
    mutationFn: (next: { flightReviewOn: string | null; medicalExpiresOn: string | null }) => api.logbook.setCurrencyDates(next),
    onSuccess: (c: Currency) => queryClient.setQueryData(["currency"], c),
  });
  const [askDelete, deleteDialog] = useConfirm({
    title: "Take this flight out of the logbook?", description: "It goes from your logbook and your currency. This can't be undone.",
    confirmLabel: "Delete", destructive: true, onConfirm: () => { if (toDelete) remove.mutate(toDelete.id); },
  });

  const reviewOn = currency?.flightReviewOn ?? null;
  const medicalOn = currency?.medicalExpiresOn ?? null;
  const met = training?.experience.filter(i => i.met).length ?? 0;
  return (
    <ConsolePages
      back="Logbook"
      pages={{ checkride: { title: "Private pilot checkride", content: <CheckridePage training={training} /> } }}
    >
    <section aria-label="Logbook" className="space-y-5">
      <ListGroup>
        <PageRow
          page="checkride" title="Checkride" media={<GraduationCap className="size-5 text-tint" />}
          description="61.109 experience, knowledge test codes, endorsements"
          value={training ? `${met} of ${training.experience.length}` : undefined}
        />
      </ListGroup>
      <ListGroup title="Currency" footer="From your logbook and the two dates above it: no one's sign-off. 61.57 counts takeoffs and landings in the same category and class; at night, to a full stop.">
        <ListRow title="Passengers by day" description="3 takeoffs and landings in 90 days"><Until date={currency?.dayPassengersUntil} what="day" /></ListRow>
        <ListRow title="Passengers at night" description="3 to a full stop at night in 90 days"><Until date={currency?.nightPassengersUntil} what="night" /></ListRow>
        <ListRow title="Flight review" description={currency?.flightReviewUntil ? <Until date={currency.flightReviewUntil} what="review" /> : "Within 24 calendar months"}>
          <DateField value={reviewOn} label="Flight review date" testId="flight-review-date" onChange={v => dates.mutate({ flightReviewOn: v, medicalExpiresOn: medicalOn })} />
        </ListRow>
        <ListRow title="Medical" description={medicalOn ? <Until date={medicalOn} what="medical" /> : "The day it expires"}>
          <DateField value={medicalOn} label="Medical expires" testId="medical-date" onChange={v => dates.mutate({ flightReviewOn: reviewOn, medicalExpiresOn: v })} />
        </ListRow>
      </ListGroup>

      {currency && currency.flights > 0 && (
        <ListGroup title="Totals">
          <ListRow title="Total" value={`${currency.totalHours.toFixed(1)} h`} />
          <ListRow title="Night" value={`${currency.nightHours.toFixed(1)} h`} />
          <ListRow title="Cross-country" value={`${currency.crossCountryHours.toFixed(1)} h`} />
          <ListRow title="Landings" value={currency.landings} />
        </ListGroup>
      )}

      {/* A row opens its flight's form, placed by the list. */}
      <ResponsivePopover open={!!changing} onOpenChange={open => { if (!open) setChanging(null); }}>
        <ResponsivePopoverAnchor asChild>
          <div>
            <ListGroup
              title="Flights"
              action={(
                <span className="flex items-center gap-1">
                  {(entries?.length ?? 0) > 0 && (
                    <Button type="button" variant="ghost" size="sm" className={cn("h-auto px-1 py-0.5 font-normal text-tint", TEXT.row)} onClick={() => setEditing(e => !e)} data-testid="logbook-edit">
                      {editing ? "Done" : "Edit"}
                    </Button>
                  )}
                  <ResponsivePopover open={adding} onOpenChange={setAdding}>
                    <ResponsivePopoverTrigger asChild>
                      <IconButton label="Log a flight" className="text-tint" data-testid="logbook-add"><Plus /></IconButton>
                    </ResponsivePopoverTrigger>
                    <ResponsivePopoverContent title="Log a flight" className="w-80 p-3" align="end">
                      <EntryForm initial={{ ...BLANK, aircraft: aircraft ?? "" }} saving={save.isPending} onSave={entry => save.mutate({ entry })} />
                    </ResponsivePopoverContent>
                  </ResponsivePopover>
                </span>
              )}
            >
              {isLoading ? <ListRow title={<span className="text-muted-foreground">Fetching your logbook…</span>} />
                : !entries?.length ? <ListRow title={<span className="text-muted-foreground">No flights logged yet: the plus logs one.</span>} />
                  : entries.map(e => (
                    <ListRow
                      key={e.id}
                      media={editing ? (
                        <IconButton label={`Delete the flight of ${day(e.flownOn)}`} className="text-destructive" onClick={() => { setToDelete(e); askDelete(); }}>
                          <CircleMinus />
                        </IconButton>
                      ) : undefined}
                      title={`${day(e.flownOn)}${e.route ? ` · ${e.route}` : ""}`}
                      description={[e.aircraft, e.aircraftType, `${e.dayLandings + e.nightLandings} landing${e.dayLandings + e.nightLandings === 1 ? "" : "s"}`, e.remarks].filter(Boolean).join(" · ")}
                      value={`${e.totalHours.toFixed(1)} h`}
                      onClick={editing ? undefined : () => setChanging(e)}
                      data-testid="logbook-entry"
                    />
                  ))}
            </ListGroup>
          </div>
        </ResponsivePopoverAnchor>
        <ResponsivePopoverContent title="The flight" className="w-80 p-3" align="end">
          {changing && (
            <EntryForm
              initial={{ ...changing, aircraft: changing.aircraft ?? "", aircraftType: changing.aircraftType ?? "", route: changing.route ?? "", remarks: changing.remarks ?? "" }}
              saving={save.isPending} onSave={entry => save.mutate({ id: changing.id, entry })}
            />
          )}
        </ResponsivePopoverContent>
      </ResponsivePopover>
      {deleteDialog}
    </section>
    </ConsolePages>
  );
}
