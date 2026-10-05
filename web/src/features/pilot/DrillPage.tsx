import { useState } from "react";
import { formatDistanceStrict } from "date-fns";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { Button } from "../../components/ui/button";
import { answered, DECKS, dueCards, keepProgress, keptProgress, nextDue, type Card, type DeckKey, type Light } from "../../lib/drills";
import { TEXT } from "../../lib/text";

const LIGHT: Record<Light, string> = { green: "#16a34a", red: "#dc2626", white: "#f8fafc" };

/** The tower's light as the card shows it: a lamp, flashing or
 *  alternating as the signal does, and said in words beside it. */
function Lamp({ light }: { light: NonNullable<Card["light"]> }) {
  const [a, b] = light.colors;
  const alternating = !!b;
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden
        className="inline-block size-12 shrink-0 rounded-full border border-black/15 shadow-inner motion-reduce:animate-none"
        style={{
          backgroundColor: LIGHT[a!],
          ...(alternating
            ? { ["--light-a" as string]: LIGHT[a!], ["--light-b" as string]: LIGHT[b], animation: "light-alternate 1.2s infinite" }
            : light.flashing ? { animation: "light-flash 1s infinite" } : {}),
        }}
      />
      <span className={cn("text-muted-foreground", TEXT.note)}>
        {alternating ? "Alternating" : light.flashing ? "Flashing" : "Steady"}
      </span>
    </span>
  );
}

/**
 * One drill (lib/drills): the cards due, one at a time -- the prompt,
 * Show the answer, then Knew it or Missed it, which moves the card up a
 * box or back to the first. A card missed comes round again before the
 * session ends. With nothing due, when the next card is, and Practice
 * them all, which keeps no score.
 */
export default function DrillPage({ deck: key }: { deck: DeckKey }) {
  const deck = DECKS[key];
  const [progress, setProgress] = useState(() => keptProgress(key));
  const [queue, setQueue] = useState<string[]>(() => dueCards(deck, keptProgress(key), Date.now()).map(c => c.id));
  const [practice, setPractice] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  // When the page opened or the last card was answered: what "the next
  // one is due in" is reckoned from.
  const [now, setNow] = useState(() => Date.now());
  const card = deck.cards.find(c => c.id === queue[0]);

  const answer = (knew: boolean) => {
    if (!card) return;
    const t = Date.now();
    setNow(t);
    if (!practice) {
      const next = answered(progress, card.id, knew, t);
      setProgress(next);
      keepProgress(key, next);
    }
    setQueue(q => (knew ? q.slice(1) : [...q.slice(1), q[0]!]));
    if (knew) setDone(d => d + 1);
    setRevealed(false);
  };

  if (!card) {
    const next = nextDue(deck, progress, now);
    return (
      <div className="space-y-4" data-testid="drill-done">
        <ListGroup footer={`From ${deck.source}. Each card known comes back later: a day, three, a week, a fortnight.`}>
          <ListRow
            title={done ? `${done} card${done === 1 ? "" : "s"} done` : "Nothing due"}
            description={next ? `The next one is due in ${formatDistanceStrict(next, now)}.` : "Every card is new: start whenever you like."}
          />
          <ListRow title="Practice them all" onClick={() => { setPractice(true); setQueue(deck.cards.map(c => c.id)); setDone(0); }} data-testid="drill-practice" />
        </ListGroup>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="drill">
      <p className={cn("text-muted-foreground tabular-nums", TEXT.note)}>
        {practice ? "Practice: no score kept" : `${queue.length} to go`}{done ? ` · ${done} done` : ""}
      </p>
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        {card.light && <Lamp light={card.light} />}
        <p className={cn("font-semibold", TEXT.title)} data-testid="drill-prompt">{card.prompt}</p>
        {revealed ? (
          <div className="space-y-1" data-testid="drill-answer">
            <p className={cn("font-medium", TEXT.prose)}>{card.answer}</p>
            {card.detail && <p className={cn("text-muted-foreground", TEXT.detail)}>{card.detail}</p>}
          </div>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={() => setRevealed(true)} data-testid="drill-reveal">
            Show the answer
          </Button>
        )}
      </div>
      {revealed && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => answer(false)} data-testid="drill-missed">Missed it</Button>
          <Button type="button" onClick={() => answer(true)} data-testid="drill-knew">Knew it</Button>
        </div>
      )}
      <ListGroup footer="Your progress is kept in this browser.">
        <ListRow title={deck.source} description="The regulation, in its own words" href={deck.url} />
      </ListGroup>
    </div>
  );
}
