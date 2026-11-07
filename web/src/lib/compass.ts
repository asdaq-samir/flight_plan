import { callEngine, type EngineAnswer } from "./engine/engine";

type Word = EngineAnswer<"compass_word">;

/** Each of the engine's eight points as the screen writes it short. */
const SHORT: Record<Word, string> = {
  north: "N", northeast: "NE", east: "E", southeast: "SE", south: "S", southwest: "SW", west: "W", northwest: "NW",
};
const SAID: Record<string, Word> = Object.fromEntries(Object.entries(SHORT).map(([word, short]) => [short, word as Word]));

/** A bearing as one of the eight compass points, in words ("northeast"):
 *  the engine's (runway pick.rs compass_word), the planner's and the
 *  phones' own. */
export function compassWord(bearingDeg: number): Word {
  return callEngine("compass_word", { bearing_deg: bearingDeg });
}

/** A bearing as a rough compass point -- "along the course" means
 *  nothing to someone picturing the chart; a direction does. Shared
 *  between both pages' checkpoint/waypoint lists: the engine's point,
 *  written short ("NE"). */
export function compassPoint(bearingDeg: number): string {
  return SHORT[compassWord(bearingDeg)];
}

/** A compass point as said, where "NE" would be read out letter by
 *  letter: a voice's or a screen reader's "northeast". */
export const saidPoint = (point: string) => SAID[point] ?? point;
