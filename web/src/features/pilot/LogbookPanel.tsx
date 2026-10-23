import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { FileDown, FileUp, GraduationCap, Mail, MailX, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ConsolePages, PageRow } from "../../components/ConsolePages";
import IconButton from "../../components/IconButton";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../components/ResponsivePopover";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useConfirm } from "../../components/useConfirm";
import TogglePill from "../../components/TogglePill";
import { api, describeError } from "../../lib/api/client";
import { shareFile } from "../../lib/flightPlanFiles";
import { importLogbook, logbookCsv } from "../../lib/logbookCsv";
import { showError } from "../../lib/problems";
import type { Currency, LogbookEntry, LogbookEntryRequest } from "../../lib/api/types";
import { TEXT } from "../../lib/text";
import CheckridePage from "./CheckridePage";
import QueryState from "../../components/QueryState";
import InstructorPage from "./InstructorPage";
import { localDay } from "../../lib/clock";
import { FINDING_TONE } from "../../lib/status";
import { currencyQuery, trainingQuery } from "../../lib/queryClient";
import { EditToggle, RemoveMinus } from "../../components/Favorites";
import { SwipeToDelete } from "../../components/SwipeToDelete";

const day = (iso: string) => format(parseISO(iso), "d MMM yyyy");
const today = () => localDay();

/** "To 19 Dec 2026" in the tint's green, or "Not current" in red. */
function Until({ date, what }: { date: string | null | undefined; what: string }) {
  const current = !!date && date >= today();
  return (
    <span className={cn("tabular-nums", current ? FINDING_TONE.ok : FINDING_TONE.stop)} data-testid={`currency-${what}`}>
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
  approaches: 0, holding: false, tracking: false,
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
      {field("aircraft", "Airplane")}
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
      {/* What instrument currency is counted from (14 CFR 61.57(c)): the
          approaches, holding and tracking courses, actual or simulated. */}
      {field("approaches", "Approaches", "number")}
      <div className={cn("grid grid-cols-[8rem_1fr] items-center gap-2", TEXT.detail)}>
        <span>Also flew</span>
        <span className="flex gap-2">
          <TogglePill pressed={entry.holding} onPressedChange={holding => setEntry({ ...entry, holding })} label="Holding" testId="logbook-holding" />
          <TogglePill pressed={entry.tracking} onPressedChange={tracking => setEntry({ ...entry, tracking })} label="Tracking" testId="logbook-tracking" />
        </span>
      </div>
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
 * they give, and instrument currency (61.57(c)) with the last proficiency
 * check -- then the totals and the flights, newest first. Add opens
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
  // Quiet: the list says in place what it could not fetch (QueryState),
  // where a failure read "No flights logged yet".
  const entriesAsked = useQuery({ queryKey: ["logbook"], queryFn: api.logbook.list, meta: { silent: true } });
  const entries = entriesAsked.data;
  const { data: currency } = useQuery(currencyQuery);
  const { data: training } = useQuery(trainingQuery);
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
    mutationFn: (next: { flightReviewOn: string | null; medicalExpiresOn: string | null; ipcOn: string | null }) => api.logbook.setCurrencyDates(next),
    onSuccess: (c: Currency) => queryClient.setQueryData(["currency"], c),
  });
  const [askDelete, deleteDialog] = useConfirm({
    title: "Take this flight out of the logbook?", description: "It goes from your logbook and your currency. This can't be undone.",
    confirmLabel: "Delete", destructive: true, onConfirm: () => { if (toDelete) remove.mutate(toDelete.id); },
  });

  // Emailed 30 and 7 days before each of these runs out (ReminderService),
  // at the pilot's ask.
  const { data: reminders } = useQuery({ queryKey: ["reminders"], queryFn: api.logbook.reminders });
  const remind = useMutation({
    mutationFn: (on: boolean) => api.logbook.setReminders(on),
    onSuccess: r => queryClient.setQueryData(["reminders"], r),
  });
  const reviewOn = currency?.flightReviewOn ?? null;
  const medicalOn = currency?.medicalExpiresOn ?? null;
  const ipcOn = currency?.ipcOn ?? null;
  // The dates given, each changed on its own.
  const setDates = (change: Partial<{ flightReviewOn: string | null; medicalExpiresOn: string | null; ipcOn: string | null }>) =>
    dates.mutate({ flightReviewOn: reviewOn, medicalExpiresOn: medicalOn, ipcOn, ...change });
  // Lapsed more than six calendar months: only a check restores it (61.57(d)).
  const ipcNeeded = !!currency?.ipcNeededAfter && currency.ipcNeededAfter < today();
  const met = training?.experience.filter(i => i.met).length ?? 0;
  // The logbook to and from a file (lib/logbookCsv): ForeFlight's export,
  // or this one's own, read on the device and sent as entries; what was
  // left out, and why, said under the rows.
  const fileInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<string | null>(null);
  const bringIn = useMutation({
    mutationFn: async (file: File) => {
      const read = importLogbook(await file.text());
      if (!read.entries.length) return { read, result: { added: 0, duplicates: 0 } };
      return { read, result: await api.logbook.importAll(read.entries) };
    },
    onSuccess: ({ read, result }) => {
      const left = read.skipped.slice(0, 3).map(s => `line ${s.line}: ${s.reason}`).join("; ");
      setImported([
        `${result.added} flight${result.added === 1 ? "" : "s"} added`,
        result.duplicates ? `${result.duplicates} already in your logbook` : "",
        read.skipped.length ? `${read.skipped.length} row${read.skipped.length === 1 ? "" : "s"} left out (${left}${read.skipped.length > 3 ? "; …" : ""})` : "",
      ].filter(Boolean).join(", ") + ".");
      refresh();
    },
    onError: err => showError("Could not import the logbook", describeError(err)),
  });
  const exportFile = async () => {
    try {
      await shareFile(`logbook-${today()}.csv`, "text/csv", logbookCsv(entries ?? []));
    } catch (err) {
      if ((err as Error).name !== "AbortError") showError("Could not export the logbook", (err as Error).message);
    }
  };
  return (
    <ConsolePages
      back="Logbook"
      pages={{
        checkride: { title: "Private pilot checkride", content: <CheckridePage /> },
        instructing: { title: "Instructing", content: <InstructorPage /> },
      }}
    >
    <section aria-label="Logbook" className="space-y-5">
      <ListGroup>
        <PageRow
          page="checkride" title="Checkride" media={<GraduationCap className="size-5 text-tint" />}
          description="61.109 experience, knowledge test codes, endorsements, your instructor"
          value={training ? `${met} of ${training.experience.length}` : undefined}
        />
        {/* A flight instructor's students, their reviews and what they
            signed (InstructorPage): for anyone to set up, as a student
            asks an instructor in by address. */}
        <PageRow
          page="instructing" title="Instructing" media={<Users className="size-5 text-tint" />}
          description="Your students, their solo cross-countries and the endorsements you sign"
        />
      </ListGroup>
      {/* From the logbook and the two dates above it, no one's sign-off: 61.57
          counts takeoffs and landings in the same category and class; at
          night, to a full stop. */}
      <ListGroup title="Currency">
        <ListRow title="Passengers by day" description="3 takeoffs and landings in 90 days"><Until date={currency?.dayPassengersUntil} what="day" /></ListRow>
        <ListRow title="Passengers at night" description="3 to a full stop at night in 90 days"><Until date={currency?.nightPassengersUntil} what="night" /></ListRow>
        <ListRow title="Flight review" description={currency?.flightReviewUntil ? <Until date={currency.flightReviewUntil} what="review" /> : "Within 24 calendar months"}>
          <DateField value={reviewOn} label="Flight review date" testId="flight-review-date" onChange={v => setDates({ flightReviewOn: v })} />
        </ListRow>
        <ListRow title="Medical" description={medicalOn ? <Until date={medicalOn} what="medical" /> : "The day it expires"}>
          <DateField value={medicalOn} label="Medical expires" testId="medical-date" onChange={v => setDates({ medicalExpiresOn: v })} />
        </ListRow>
        <ListRow title="Reminders" description="An email 30 and 7 days before each runs out">
          <TogglePill
            pressed={!!reminders?.on} onPressedChange={on => remind.mutate(on)} disabled={!reminders || remind.isPending}
            icon={reminders?.on ? <Mail /> : <MailX />} label="Email" testId="reminders-toggle"
          />
        </ListRow>
      </ListGroup>

      {/* Instrument currency (14 CFR 61.57(c), (d)), from the approaches,
          holding and tracking logged with each flight, and the last check. */}
      {/* Six approaches, holding and tracking in the 6 calendar months
          before the month flown, actual or simulated; more than six months
          past, only an instrument proficiency check restores it. */}
      <ListGroup title="Instrument">
        <ListRow
          title="Instrument currency"
          description={`${currency?.approachesInWindow ?? 0} of 6 approaches${currency?.holdingInWindow ? ", holding" : ""}${currency?.trackingInWindow ? ", tracking" : ""} in the window`}
        >
          {ipcNeeded ? <span className={FINDING_TONE.stop} data-testid="currency-instrument">IPC needed</span>
            : <Until date={currency?.instrumentCurrentUntil} what="instrument" />}
        </ListRow>
        <ListRow title="Proficiency check" description={ipcOn ? `On ${day(ipcOn)}` : "The day of your last IPC"}>
          <DateField value={ipcOn} label="Instrument proficiency check date" testId="ipc-date" onChange={v => setDates({ ipcOn: v })} />
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

      <input
        ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" data-testid="logbook-import-file"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) bringIn.mutate(file);
        }}
      />
      {/* A CSV file: ForeFlight's logbook export, or this logbook's own; a
          flight already here (the same day, airplane, route and time) is
          not added twice. What an import brought in, said in a row. */}
      <ListGroup title="File">
        {imported && <ListRow muted title={<>{imported}</>} data-testid="logbook-imported" />}
        <ListRow
          title="Import a logbook" media={<FileUp className="size-5" />}
          onClick={() => fileInput.current?.click()} disabled={bringIn.isPending} data-testid="logbook-import"
        />
        <ListRow
          title="Export as CSV" media={<FileDown className="size-5" />}
          onClick={() => void exportFile()} disabled={!entries?.length} data-testid="logbook-export"
        />
      </ListGroup>

      {/* A row opens its flight's form, placed by the list. */}
      <ResponsivePopover open={!!changing} onOpenChange={open => { if (!open) setChanging(null); }}>
        <ResponsivePopoverAnchor asChild>
          <div>
            <ListGroup
              title="Flights"
              action={(
                <span className="flex items-center gap-1">
                  {/* Every list's Edit (EditToggle), where this was a copy of it. */}
                  {(entries?.length ?? 0) > 0 && <EditToggle editing={editing} onToggle={() => setEditing(e => !e)} testId="logbook-edit" />}
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
              {!entries ? <QueryState row query={entriesAsked} fetching="Fetching your logbook…" failed="Your logbook could not be fetched." />
                : !entries.length ? <ListRow muted title="No flights logged yet: the plus logs one." />
                  : entries.map(e => (
                    // Taken off as every kept list's rows are -- a swipe to
                    // the left, or Edit's minus bringing out the Delete --
                    // asked first, the entry being the server's.
                    <SwipeToDelete key={e.id} label={`Delete the flight of ${day(e.flownOn)}`} onDelete={() => { setToDelete(e); askDelete(); }}>
                      <ListRow
                        media={editing ? <RemoveMinus label={`Delete the flight of ${day(e.flownOn)}…`} /> : undefined}
                        title={`${day(e.flownOn)}${e.route ? ` · ${e.route}` : ""}`}
                        description={[e.aircraft, e.aircraftType, `${e.dayLandings + e.nightLandings} landing${e.dayLandings + e.nightLandings === 1 ? "" : "s"}`, e.remarks].filter(Boolean).join(" · ")}
                        value={`${e.totalHours.toFixed(1)} h`}
                        onClick={editing ? undefined : () => setChanging(e)}
                        data-testid="logbook-entry"
                      />
                    </SwipeToDelete>
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
