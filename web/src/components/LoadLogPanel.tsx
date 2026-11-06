import { ListGroup, ListRow } from "./GroupedList";
import { MILESTONES, median, useLoadLog, type LoadEntry } from "../lib/loadLog";
import { TEXT } from "../lib/text";

/** Seconds to a tenth, as the timing was reported: "4.5 s". */
const seconds = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

/**
 * Setup's Log, beside Status, at the owner's ask ("We should log the
 * fresh map load timing in a log page next to Status in setup",
 * 2026-11-05): when each of the map's layers showed at this device's
 * loads (lib/loadLog). The middle of the last fresh loads and of the
 * last loads from the cache first, each milestone a row in the order
 * they come in; then each load, newest first, its time and how long its
 * airports took, the slowest, opened for all of its milestones.
 */
export default function LoadLogPanel() {
  const loads = useLoadLog(s => s.value);
  const fresh = loads.filter(l => l.fresh);
  const cached = loads.filter(l => !l.fresh);
  return (
    <div className="space-y-5 pb-1" data-testid="load-log">
      {!loads.length && <ListGroup><ListRow muted title="No loads yet" description={<span className={TEXT.detail}>Each time the app opens on the map, when its layers show is kept here.</span>} /></ListGroup>}
      {fresh.length > 0 && <Middle title={`Fresh loads, middle of ${fresh.length}`} loads={fresh} testId="load-log-fresh" />}
      {cached.length > 0 && <Middle title={`From the cache, middle of ${cached.length}`} loads={cached} testId="load-log-cached" />}
      {loads.length > 0 && (
        <ListGroup title="Each load">
          {loads.map(l => <LoadRow key={l.at} load={l} />)}
        </ListGroup>
      )}
    </div>
  );
}

function Middle({ title, loads, testId }: { title: string; loads: LoadEntry[]; testId: string }) {
  const rows = MILESTONES.map(m => ({ ...m, value: median(loads.map(l => l.ms[m.key])) }))
    .sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity));
  return (
    <ListGroup title={title}>
      {rows.map(r => <ListRow key={r.key} title={r.label} value={seconds(r.value)} data-testid={`${testId}-${r.key}`} />)}
    </ListGroup>
  );
}

function LoadRow({ load }: { load: LoadEntry }) {
  const when = new Date(load.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const steps = MILESTONES.filter(m => load.ms[m.key] !== undefined)
    .sort((a, b) => load.ms[a.key]! - load.ms[b.key]!)
    .map(m => `${m.label} ${seconds(load.ms[m.key])}`).join(" · ");
  return (
    <ListRow
      title={when} value={`Airports ${seconds(load.ms.airports)}`} data-testid="load-log-entry"
      description={<span className={TEXT.detail}>{load.fresh ? "Fresh" : "From the cache"} · {steps}</span>}
    />
  );
}
