import { useId, useState } from "react";
import FieldHit from "../../components/FieldHit";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { Input } from "../../components/ui/input";
import PullDown from "../../components/PullDown";
import { Textarea } from "../../components/ui/textarea";
import type { InstructorLink } from "../../lib/api/types";
import { localDay } from "../../lib/clock";

/** What a solo cross-country's review is asked with. */
export interface ReviewAsk {
  instructorId: number;
  makeModel: string;
  flightOn: string;
  note: string | null;
}

/**
 * The rows that put a flight to the student's instructor for the review
 * 14 CFR 61.93(c)(3) and (d) ask before each solo cross-country: which of
 * their instructors (where they have more than one), the airplane's make
 * and model and the day, as the endorsement will name them, and a note.
 * A saved flight's page asks with it, and the route's Share menu.
 */
export function ReviewAskForm({ instructors, initialDay, pending, onAsk }: {
  /** Taken ones only: an instructor still to answer has no reviews. */
  instructors: InstructorLink[];
  initialDay?: string;
  pending: boolean;
  onAsk: (ask: ReviewAsk) => void;
}) {
  const ids = { mm: useId(), on: useId() };
  const [instructorId, setInstructorId] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [flightOn, setFlightOn] = useState(initialDay ?? localDay());
  const [note, setNote] = useState("");
  const chosen = instructors.find(l => String(l.id) === instructorId) ?? instructors[0];
  if (!chosen) return null;
  return (
    <ListGroup>
      {instructors.length > 1 && (
        <ListRow title="Instructor">
          <PullDown label="Instructor" value={`${chosen.id}`} options={instructors.map(l => ({ value: `${l.id}`, label: l.name ?? l.email }))} onChange={setInstructorId} />
        </ListRow>
      )}
      <ListRow id={ids.mm} title="Make and model">
        <FieldHit htmlFor={ids.mm}><Input id={ids.mm} value={makeModel} placeholder="Cessna 172" maxLength={80} className="h-8 w-44"
          onChange={e => setMakeModel(e.target.value)} data-testid="review-make-model" /></FieldHit>
      </ListRow>
      <ListRow id={ids.on} title="Day of the flight">
        <FieldHit htmlFor={ids.on}><Input id={ids.on} type="date" value={flightOn} min={localDay()} className="h-8 w-40"
          onChange={e => setFlightOn(e.target.value || localDay())} data-testid="review-day" /></FieldHit>
      </ListRow>
      <div className="p-2">
        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500}
          placeholder="A note for your instructor" aria-label="A note for your instructor" data-testid="review-note" />
      </div>
      <ListRow
        title={<span className="font-medium text-tint">Ask {chosen.name ?? chosen.email} to review it</span>}
        disabled={!makeModel.trim() || pending} data-testid="review-ask"
        onClick={() => onAsk({ instructorId: chosen.id, makeModel: makeModel.trim(), flightOn, note: note.trim() || null })}
      />
    </ListGroup>
  );
}
