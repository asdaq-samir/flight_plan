import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../components/ui/button";
import { words } from "../../lib/api/words";
import type { Debrief } from "../../lib/debrief";
import { pilotQuery, trainingQuery } from "../../lib/queryClient";
import { useCopied } from "../../lib/share";
import { TEXT } from "../../lib/text";
import WordsSection from "../plan/components/briefing/WordsSection";
import { wordsState } from "../plan/components/briefing/wordsState";

/** The debrief as the words are asked of it: its figures -- the legs,
 *  the checkpoints, the patterns, the notes -- without the flown line
 *  and the profile, thousands of points that say nothing a sentence can
 *  use and would be sent with every ask. */
const forWords = (d: Debrief) => ({
  takeoff: d.takeoff, landing: d.landing, flown_min: d.flownMin, planned_min: d.plannedMin,
  legs: d.legs.map(({ ok: _ok, ...leg }) => leg),
  passes: d.passes.map(({ landed: _landed, lateMin: _late, ok: _ok, ...pass }) => pass),
  patterns: d.patterns.map(({ offFt: _off, ok: _ok, ...pattern }) => pattern), has_altitude: d.hasAltitude, notes: d.notes,
});

/**
 * "What to practise next", under the debrief's figures (FlightPage): the
 * flight's debrief read in words, with the figures it rests on as chips
 * (WordsSection), and for a pilot with an instructor the line written
 * for them. The app has no way to send an instructor a note on its own
 * -- a solo cross-country review asks for one with a flight, not this --
 * so the line is copied for them instead.
 */
export default function DebriefWords({ flightId, debrief }: { flightId: number; debrief: Debrief }) {
  const body = forWords(debrief);
  const query = useQuery({
    queryKey: ["words", "debrief", flightId, body],
    queryFn: ({ signal }) => words.debrief(body, signal),
    staleTime: 10 * 60_000, meta: { silent: true },
  });
  const { data: pilot } = useQuery(pilotQuery);
  const { data: training } = useQuery({ ...trainingQuery, enabled: !!pilot });
  const hasInstructor = !!training?.instructors.some(l => l.accepted);
  const [copied, setCopied] = useCopied();
  const note = query.data?.instructor_note ?? null;
  return (
    <WordsSection title="What to practise next" testId="debrief-words" state={wordsState(query)}>
      {note && hasInstructor && (
        <div className="flex flex-col gap-2 pt-2" data-testid="debrief-instructor-note">
          <p className={cn("tabular-nums", TEXT.prose)}><span className="font-semibold">For your instructor: </span>{note}</p>
          <Button
            variant="outline" size="sm" className="self-start" data-testid="debrief-copy-note"
            onClick={() => void navigator.clipboard?.writeText(note).then(() => setCopied("note")).catch(() => {})}
          >
            {copied === "note" ? <Check /> : <Copy />}{copied === "note" ? "Copied" : "Copy for your instructor"}
          </Button>
        </div>
      )}
    </WordsSection>
  );
}
