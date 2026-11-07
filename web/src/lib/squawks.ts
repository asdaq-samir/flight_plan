import { callEngine } from "./engine/engine";

/** What a squawk says, where it says more than a code: the three a pilot
 *  sets in trouble -- 7700 an emergency (AIM 6-2-2), 7500 unlawful
 *  interference (AIM 6-3-4, air piracy), 7600 two-way radio failure (AIM
 *  6-4-2) -- in the engine's words (squawk_meaning); null for any other. */
export function squawkMeaning(squawk: string | null | undefined): string | null {
  return callEngine("squawk_meaning", { squawk: squawk ?? null });
}
