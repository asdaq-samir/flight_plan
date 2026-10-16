import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import QueryState from "../../components/QueryState";
import { Textarea } from "../../components/ui/textarea";
import { api } from "../../lib/api/client";
import type { Aircraft } from "../../lib/api/types";
import { checklistOf, textOf } from "../../lib/checklist";
import { TEXT } from "../../lib/text";

/**
 * An airplane's checklist, as its owner writes it from the airplane's
 * flight manual (lib/checklist): run, each item ticked as it is done, a
 * section's count beside its title -- or written, as plain text, a
 * section a line starting "#", an item a line with its response after a
 * dash. The app writes none of its own: the manual's is the airplane's.
 * The ticks are this run's, kept on the page until Start over.
 */
export default function ChecklistPage({ aircraft }: { aircraft: Aircraft }) {
  const queryClient = useQueryClient();
  // Quiet: the page says in place what it could not fetch (QueryState).
  const asked = useQuery({ queryKey: ["checklist", aircraft.id], queryFn: () => api.aircraft.checklist(aircraft.id), meta: { silent: true } });
  const checklist = asked.data;
  const [writing, setWriting] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const save = useMutation({
    mutationFn: (text: string) => api.aircraft.saveChecklist(aircraft.id, checklistOf(text)),
    onSuccess: saved => {
      queryClient.setQueryData(["checklist", aircraft.id], saved);
      setWriting(null);
      setTicked({});
      toast.success("Checklist saved");
    },
  });
  if (!checklist) return <QueryState query={asked} fetching="Fetching the checklist…" failed="The checklist could not be fetched." />;

  if (writing !== null) {
    return (
      <div className="space-y-3">
        {/* A line starting # is a section; every other line an item, its
            response after a dash, as the placeholder shows. */}
        <ListGroup>
          <div className="p-2">
            <Textarea
              value={writing} onChange={e => setWriting(e.target.value)} rows={14} className="font-mono"
              aria-label={`${aircraft.tailNumber} checklist`} data-testid="checklist-text"
              placeholder={"# Before takeoff\nFuel selector -- Both\nMixture -- Rich"}
            />
          </div>
        </ListGroup>
        <ListGroup>
          <ListRow title={<span className="font-medium text-tint">Save checklist</span>} onClick={() => save.mutate(writing)} disabled={save.isPending} data-testid="checklist-save" />
          <ListRow title="Cancel" onClick={() => setWriting(null)} />
        </ListGroup>
      </div>
    );
  }

  const empty = checklist.sections.length === 0;
  return (
    <div className="space-y-4" data-testid="checklist">
      {empty && (
        <ListGroup>
          <ListRow title="No checklist yet" />
        </ListGroup>
      )}
      {checklist.sections.map((section, s) => {
        const done = section.items.filter((_, i) => ticked[`${s}:${i}`]).length;
        return (
          <ListGroup
            key={`${s}:${section.title}`} title={section.title}
            badge={<span className={cn("tabular-nums text-muted-foreground", TEXT.note)}>{done} of {section.items.length}</span>}
          >
            {section.items.map((item, i) => {
              const on = !!ticked[`${s}:${i}`];
              return (
                <ListRow
                  key={i} checkbox={{ checked: on, onChange: next => setTicked(t => ({ ...t, [`${s}:${i}`]: next })) }}
                  title={<span className={cn(on && "text-muted-foreground")}>{item.challenge}</span>}
                  value={item.response ?? undefined}
                  data-testid="checklist-item"
                />
              );
            })}
          </ListGroup>
        );
      })}
      <ListGroup>
        {!empty && <ListRow title="Start over" onClick={() => setTicked({})} disabled={!Object.values(ticked).some(Boolean)} data-testid="checklist-reset" />}
        <ListRow title={empty ? "Write the checklist" : "Edit the checklist"} onClick={() => setWriting(textOf(checklist))} data-testid="checklist-edit" />
      </ListGroup>
    </div>
  );
}
