import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { formText, type FlightPlanForm } from "../../../../lib/flightPlanForm";
import { showError } from "../../../../lib/problems";
import { api, describeError } from "../../../../lib/api/client";
import type { FlightPlanFilingRequest } from "../../../../lib/api/types";
import { pilotQuery } from "../../../../lib/queryClient";

/**
 * The Brief tab's Flight Plan: the FAA's form (FAA Form 7233-4) filled in
 * from the plan, a flight to a group (lib/flightPlanForm), to copy into a
 * filing service or read to Flight Service. Filing itself is theirs:
 * 1800wxbrief.com and Flight Service are the FAA's, at no charge, and
 * ForeFlight and Garmin Pilot file through them. Where the app has Flight
 * Service connected (FlightServiceController, the owner's agreement with
 * its provider), each form is filed from here too, in the pilot's name.
 */
export default function FlightPlanSection({ forms, ifr }: { forms: FlightPlanForm[]; ifr: boolean }) {
  // "Copied" on the row tapped, for a moment, where it was tapped.
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const done = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(done);
  }, [copied]);
  // Filing from here, where Flight Service is connected: never until the
  // owner's agreement with its provider, and then signed in.
  const { data: pilot } = useQuery(pilotQuery);
  const { data: flightService } = useQuery({ queryKey: ["flightService"], queryFn: api.flightService.status, enabled: !!pilot, staleTime: 5 * 60_000 });
  const [filed, setFiled] = useState<Record<number, string>>({});
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
        {forms.map((form, i) => {
          const route = form.items.find(f => f.key === "route")?.value ?? "";
          return (
            <ListGroup
              key={`${form.departure}-${form.destination}-${i}`}
              title={forms.length > 1 ? `${form.departure} to ${form.destination}` : undefined}
              footer={i === forms.length - 1
                ? "The FAA's flight plan form, FAA Form 7233-4, item by item as AIM Appendix 4 writes each. Your filing service's aircraft and pilot profiles hold the rest: the equipment (item 10), and the persons on board, the airplane's colour and your name and telephone (item 19)."
                : undefined}
            >
              {form.items.map(f => (
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
        <ListGroup
          title="File it"
          footer={ifr
            ? "File an IFR flight plan at least 30 minutes before departure (AIM 5-1-6)."
            : "Activate a VFR flight plan with Flight Service when you leave, and close it when you land: half an hour past your ETA unclosed, a search starts (AIM 5-1-5, 5-1-14)."}
        >
          <ListRow title="1800wxbrief.com" href="https://www.1800wxbrief.com" data-testid="flight-plan-file" />
          <ListRow title="Flight Service" description="1-800-WX-BRIEF" href="tel:18009927433" />
          <ListRow title="Flight Service in Alaska" description="1-833-AK-BRIEF" href="tel:18332527433" />
        </ListGroup>
      </div>
    </AccordionSection>
  );
}
