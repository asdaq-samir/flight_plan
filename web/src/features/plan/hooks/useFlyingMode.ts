import { useEffect, useRef } from "react";
import { useFlying } from "../../../components/mapChrome";
import type { PanelState } from "../../../components/mapChrome";
import { underway } from "../../../lib/map/glide";
import { useOwnShip } from "../../../lib/map/ownShip";
import { DRY_RUN, usePastFlight } from "../../../lib/map/pastFlight";

/**
 * Flying mode, the canvas's Flying screen (the owner's "Do it all",
 * 2026-11-03): once own ship is underway -- at flying speed by the
 * engine's rule (lib/map/glide's `underway`), the GPS's or a dry run's --
 * with a route to fly, the planner screen is the flight's: the next
 * checkpoint over the map (FlyingHead), the flight's figures grown at the
 * sheet's foot (FlightLine's `flying`), the map's buttons 60 points with
 * words (MapControls), and the route's box, the tab bar and the chips
 * put away (MapPanel's `flying`) until the airplane is on the ground
 * again: under flying speed for a minute (GROUND_MS), so a slow turn
 * or a bad fix does not bring the planner back in the air; or own ship
 * off -- a dry run closed -- at once.
 *
 * A pilot leaves it with one tap (Done flying, `done`), and it comes back
 * by itself the next time the airplane is underway after being on the
 * ground: the tap is for this flight, not a setting.
 *
 * The sheet is brought to the pill as a real flight starts, the figures
 * alone over the chart; the pilot opens it as ever for the nav log. A dry
 * run keeps the sheet where the pilot has it, its card's chart and its
 * play, scrub and close in sight -- the owner's asks that a run started
 * half way plays in the card (2026-10-20) and can be flown with the nav
 * log all the way up (2026-10-28) -- under flying mode's look, at the
 * owner's yes to keeping that look with the run's own controls back
 * (2026-11-04): pulled to the pill, they were out of sight.
 */

/** How long under flying speed before the airplane is on the ground. */
export const GROUND_MS = 60_000;

export function useFlyingMode({ routed, setPanel, nearest, direct }: {
  /** There is a route to fly: nothing to show without one. */
  routed: boolean;
  setPanel: (state: PanelState) => void;
  /** Nearest's list opened (NRST). */
  nearest: () => void;
  /** Direct to the next landing (D→): the field and the way; null with
   *  none to go direct to. */
  direct: { to: string; go: () => void } | null;
}): { flying: boolean; done: () => void } {
  // Whether, not the fix: drawn again once as the airplane leaves the
  // ground, not at every second's fix.
  const airborne = useOwnShip(s => s.enabled && s.fix !== null && underway(s.fix));
  const hasFix = useOwnShip(s => s.enabled && s.fix !== null);
  // A dry run playing counts as underway from its first frame, before the
  // simulated fix has a speed.
  const dryPlaying = usePastFlight(s => s.hex === DRY_RUN && s.playing);
  const up = airborne || dryPlaying;
  // Held in the chrome's store (useFlying), which the map's buttons and
  // lines read too: an effect sets it as the airplane moves, as an effect
  // sets any outside store.
  const flying = useFlying(s => s.flying);
  const stopped = useFlying(s => s.stopped);
  useEffect(() => {
    const set = (flying: boolean, stoppedNow?: boolean) => useFlying.setState(s => ({ flying, stopped: stoppedNow ?? s.stopped }));
    if (!routed) {
      set(false);
      return;
    }
    if (up) {
      if (!stopped) set(true);
      return;
    }
    // Under flying speed: the ground after a minute of it, or at once with
    // no position at all (own ship off, a dry run closed). Done flying is
    // forgotten with the ground, for the next flight.
    const land = () => set(false, false);
    if (!hasFix && !dryPlaying) {
      land();
      return;
    }
    const timer = window.setTimeout(land, GROUND_MS);
    return () => window.clearTimeout(timer);
  }, [routed, up, hasFix, dryPlaying, stopped]);
  // Started: the sheet down to the pill, the figures alone over the chart;
  // not for a dry run, whose controls are in its card. Only as flying
  // starts: a run closed ends the run a render before flying, and the
  // sheet went to the pill then, the Profile card's close under it.
  const dryRun = usePastFlight(s => s.hex === DRY_RUN);
  const wasFlying = useRef(false);
  useEffect(() => {
    const started = flying && !wasFlying.current;
    wasFlying.current = flying;
    if (started && !dryRun) setPanel("peek");
  }, [flying, dryRun, setPanel]);
  // Its buttons' doings told to the map's chrome (MapControls), and all of
  // it taken back with the planner.
  useEffect(() => {
    useFlying.setState({ nearest: flying ? nearest : null, direct: flying ? direct : null });
  }, [flying, nearest, direct]);
  useEffect(() => () => useFlying.setState({ flying: false, stopped: false, nearest: null, direct: null }), []);
  const done = () => useFlying.setState({ flying: false, stopped: true });
  return { flying, done };
}
