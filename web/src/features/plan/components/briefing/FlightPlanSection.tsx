import { useId, useState } from "react";
import { create } from "zustand";
import { useMutation, useQuery } from "@tanstack/react-query";
import AccordionSection from "../../../../components/AccordionSection";
import FieldHit from "../../../../components/FieldHit";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { Input } from "../../../../components/ui/input";
import { formText, personsOnBoard, withPersonsOnBoard, type FlightPlanForm } from "../../../../lib/flightPlanForm";
import { showError } from "../../../../lib/problems";
import { useCopied } from "../../../../lib/share";
import { api, describeError } from "../../../../lib/api/client";
import type { FlightPlanFilingRequest } from "../../../../lib/api/types";
import { pilotQuery } from "../../../../lib/queryClient";

/**
 * The Brief tab's Flight Plan: the FAA's form (FAA Form 7233-4) filled in
 * from the plan, a flight to a group (lib/flightPlanForm), to copy into a
 * filing service or read to Flight Service. Filing itself is theirs:
 * 1800wxbrief.com and Flight Service are the FAA's, at no charge, and
 * ForeFlight and Garmin Pilot file through them: Open in 1800wxbrief
 * copies a form, an item to a line, and opens the site to paste it in.
 * The persons on board are typed here, a flight's own, kept for the
 * session (not on the device) by route. Where the app has Flight Service connected
 * (FlightServiceController, the owner's agreement with its provider),
 * each form is filed from here too, in the pilot's name.
 */
/** Item 19's persons on board as typed, by route: outside the section, so
 *  the Brief drawn again as the briefing streams in keeps them -- in the
 *  section's own state, the "2" typed was gone from the copied form once
 *  in the full suite (flight-plan.spec, 2026-10-28). */
const usePersons = create<{ typed: Record<string, string>; set: (key: string, value: string) => void }>(put => ({
  typed: {},
  set: (key, value) => put(s => ({ typed: { ...s.typed, [key]: value } })),
}));

export default function FlightPlanSection({ forms, ifr }: { forms: FlightPlanForm[]; ifr: boolean }) {
  // "Copied" on the row tapped, for a moment, where it was tapped.
  const [copied, setCopied] = useCopied();
  // Filing from here, where Flight Service is connected: never until the
  // owner's agreement with its provider, and then signed in.
  const { data: pilot } = useQuery(pilotQuery);
  const { data: flightService } = useQuery({ queryKey: ["flightService"], queryFn: api.flightService.status, enabled: !!pilot, staleTime: 5 * 60_000 });
  const [filed, setFiled] = useState<Record<number, string>>({});
  // Item 19's persons on board as typed, a flight's own: blank until the
  // pilot says, and blank on the form.
  const persons = usePersons(s => s.typed);
  const setPersons = usePersons(s => s.set);
  const personsId = useId();
  const file = useMutation({
    mutationFn: ({ plan }: { i: number; plan: FlightPlanFilingRequest }) => api.flightService.file(plan),
    onSuccess: (done, { i }) => setFiled(f => ({ ...f, [i]: done.reference })),
    onError: err => showError("Could not file the flight plan", describeError(err)),
  });
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch (err) {
      showError("Could not copy the flight plan", (err as Error).message);
    }
  };

  return (
    <AccordionSection title="Flight Plan">
      <div className="space-y-4" data-testid="flight-plan">
        {forms.map((planned, i) => {
          const key = `${planned.departure}-${planned.destination}-${i}`;
          const form = withPersonsOnBoard(planned, personsOnBoard(persons[key] ?? ""));
          const route = form.items.find(f => f.key === "route")?.value ?? "";
          return (
            <ListGroup
              key={key}
              // FAA Form 7233-4, item by item as AIM Appendix 4 writes each,
              // items 10 and 19 from the airplane's and the pilot's own pages.
              title={forms.length > 1 ? `${form.departure} to ${form.destination}` : undefined}
            >
              {form.items.map(f => f.key === "persons" ? (
                // Item 19's P/: a count, 1 to 999 as Flight Service takes it.
                <ListRow key={f.key} id={`${personsId}-${i}`} title={f.label} description={f.note}>
                  <FieldHit htmlFor={`${personsId}-${i}`}><Input
                    id={`${personsId}-${i}`} value={persons[key] ?? ""} placeholder="—" maxLength={3}
                    inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="h-8 w-16 text-right"
                    aria-invalid={!!persons[key]?.trim() && f.value == null}
                    onChange={e => setPersons(key, e.target.value)}
                    data-testid="flight-plan-persons"
                  /></FieldHit>
                </ListRow>
              ) : (
                <ListRow
                  key={f.key} title={f.label} description={f.note}
                  value={f.value ?? "—"}
                  data-testid={`flight-plan-${f.key}`}
                />
              ))}
              <ListRow
                title={copied === `route-${i}` ? "Copied" : "Copy the route"}
                onClick={() => void copy(`route-${i}`, route)}
                data-testid="flight-plan-copy-route"
              />
              <ListRow
                title={copied === `form-${i}` ? "Copied" : "Copy the flight plan"}
                onClick={() => void copy(`form-${i}`, formText(form))}
                data-testid="flight-plan-copy"
              />
              {/* The form copied in the tap, then the FAA's site opened in
                  a new tab by the row's own link, so no popup blocker holds
                  it, to paste in. */}
              <ListRow
                title="Open in 1800wxbrief"
                description={copied === `wx-${i}` ? "Copied" : "Copies this flight plan to paste in"}
                href="https://www.1800wxbrief.com"
                onClick={() => void copy(`wx-${i}`, formText(form))}
                data-testid="flight-plan-open-wx"
              />
              {flightService?.connected && (
                <ListRow
                  title={filed[i] ? "Filed with Flight Service" : "File with Flight Service"}
                  description={filed[i] ? `Reference ${filed[i]}` : !form.filing ? "Needs your airplane's registration, its type and a departure time" : undefined}
                  onClick={() => form.filing && file.mutate({ i, plan: form.filing })}
                  disabled={!form.filing || !!filed[i] || file.isPending}
                  data-testid="flight-plan-file-fss"
                />
              )}
            </ListGroup>
          );
        })}
        {/* Flight Service's site and numbers, AIM 5-1-1. */}
        {/* IFR filed at least 30 minutes before departure (AIM 5-1-6); VFR
            opened with Flight Service on leaving and closed on landing, a
            search starting half an hour past the ETA unclosed (AIM 5-1-5,
            5-1-14): said on the row, where it was a footnote. */}
        <ListGroup title="File it">
          <ListRow
            title="1800wxbrief.com" description={ifr ? "At least 30 min before departure" : "Open it as you leave, close it when you land"}
            href="https://www.1800wxbrief.com" data-testid="flight-plan-file"
          />
          <ListRow title="Flight Service" description="1-800-WX-BRIEF" href="tel:18009927433" />
          <ListRow title="Flight Service in Alaska" description="1-833-AK-BRIEF" href="tel:18332527433" />
        </ListGroup>
      </div>
    </AccordionSection>
  );
}
