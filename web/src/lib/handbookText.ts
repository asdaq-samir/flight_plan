/**
 * The planning figures in a handbook's specifications page, from the text
 * read off a photo of it (lib/readPage): the page's own lines, each a label
 * and its figure ("Service Ceiling (ft) 14,300", "SERVICE CEILING ....
 * 13,500 FT."), as Piper's and Cessna's handbooks print them. Each figure
 * comes with the line it was read from, for the pilot to check against the
 * page; one the page does not label plainly is not guessed.
 *
 * Read by the shared engine (native/crates/pilot/src/pilot/handbook.rs, through
 * lib/engine), the code the iPhone app reads a page with too, in knots
 * where the page prints mph: the rules live there.
 */
import { callEngine, type EngineAnswer } from "./engine/engine";

/** A figure read off the page, and the words it was read from; a page's
 *  figures, each left out where it was not found (the engine's contract). */
export type PageFigures = EngineAnswer<"handbook_figures">;

export function figuresOfPage(text: string): PageFigures {
  return callEngine("handbook_figures", { text });
}
