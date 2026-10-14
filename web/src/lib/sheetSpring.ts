/**
 * The map panel's sheet as Apple Maps moves its own: let go, it springs to
 * the size it settles at carrying the finger's speed -- a fast flick
 * travels faster and overshoots a little before it rests -- rather than
 * easing there over a fixed half second; and dragged past its largest or
 * smallest size it gives way less and less, a rubber band, and springs
 * back. At the owner's ask ("Yes go ahead", to matching Apple Maps' card
 * transitions). Pure arithmetic and one frame loop, for MapPanel and its
 * drag (useDetentDrag) to drive the sheet's height by.
 */

/** UIKit's default spring for a sheet, as SwiftUI names one: settling in
 *  about this many seconds (`response`), damped to this fraction of
 *  critical (`dampingFraction`) -- under one, so a flick overshoots a
 *  little. */
export const SHEET_SPRING = { response: 0.42, dampingFraction: 0.86 };

/** A spring of unit mass as its stiffness and damping. */
export function springConstants({ response, dampingFraction }: typeof SHEET_SPRING) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * dampingFraction * omega };
}

export interface SpringState {
  /** Where it is, in points. */
  x: number;
  /** How fast, in points a second. */
  v: number;
}

/** One step of `dt` seconds toward `target`: semi-implicit Euler, in
 *  sub-steps of at most 4 ms so a frame dropped by a busy phone stays
 *  stable. */
export function springStep(state: SpringState, target: number, dt: number, spring = SHEET_SPRING): SpringState {
  const { stiffness, damping } = springConstants(spring);
  let { x, v } = state;
  for (let left = dt; left > 0; left -= 0.004) {
    const h = Math.min(0.004, left);
    v += (-stiffness * (x - target) - damping * v) * h;
    x += v * h;
  }
  return { x, v };
}

/** At rest: within half a point of where it is going, and slower than a
 *  point in a tenth of a second. */
export const atRest = (state: SpringState, target: number) => Math.abs(state.x - target) < 0.5 && Math.abs(state.v) < 10;

/**
 * Springs from `from` to `to`, starting at `velocity` points a second (the
 * finger's at the let go), calling `frame` with each frame's position and
 * `done` once at rest, on `to` exactly. Answers a function that stops it
 * where it is -- a finger catching the sheet mid-motion -- which answers
 * the position and speed it was stopped at, for the drag to start from.
 */
export function animateSpring(
  from: number, to: number, velocity: number,
  frame: (x: number) => void, done: () => void,
  spring = SHEET_SPRING,
): () => SpringState {
  let state: SpringState = { x: from, v: velocity };
  let last = performance.now();
  let id = requestAnimationFrame(function tick(now) {
    // At most a tenth of a second a frame: a tab in the background, its
    // frames held, carries on from where it was rather than leaping.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    state = springStep(state, to, dt, spring);
    if (atRest(state, to)) {
      frame(to);
      done();
      return;
    }
    frame(state.x);
    id = requestAnimationFrame(tick);
  });
  return () => {
    cancelAnimationFrame(id);
    return state;
  };
}

/**
 * How far the sheet goes when the finger has gone `beyond` points past its
 * largest or smallest size: UIScrollView's rubber band, the further the
 * less, never more than `dimension` (the room it has), its coefficient
 * UIKit's 0.55. Signed as `beyond` is.
 */
export function rubberBand(beyond: number, dimension: number, coefficient = 0.55): number {
  if (dimension <= 0) return 0;
  const sign = Math.sign(beyond);
  const d = Math.abs(beyond);
  return sign * (1 - 1 / ((d * coefficient) / dimension + 1)) * dimension;
}
