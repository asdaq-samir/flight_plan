import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS, FILTER_KEYS, forwardIsLeft, forwardIsUp, hasRating,
  hiddenCount, isVisible, orderedPoints, ratedOf, roleOf, sourceOf,
} from "../app/static/logic.js";

const filters = (over = {}) => ({ ...DEFAULT_FILTERS, ...over });
const pt = (over = {}) => ({ cross_track_nm: 0, along_track_nm: 10, rating: null, ...over });

// --- role -------------------------------------------------------------

test("a stored role wins over the corridor rule", () => {
  assert.equal(roleOf(pt({ role: "visual", cross_track_nm: 0 })), "visual");
});

test("on course means you fly over it", () => {
  assert.equal(roleOf(pt({ cross_track_nm: 0.4 })), "dr");
  assert.equal(roleOf(pt({ cross_track_nm: -0.4 })), "dr");
});

test("well off course means you look at it", () => {
  assert.equal(roleOf(pt({ cross_track_nm: 3.58 })), "visual");
  assert.equal(roleOf(pt({ cross_track_nm: -1.8 })), "visual");
});

// --- source -----------------------------------------------------------

test("a pick made against a detection counts as detected even once it has drifted", () => {
  assert.equal(sourceOf({ source: "detected" }), "detected");
});

test("a detection with no source at all is still detected", () => {
  assert.equal(sourceOf({}), "detected");
});

test("only a hand-placed point is added", () => {
  assert.equal(sourceOf({ source: "added" }), "added");
});

// --- rated ------------------------------------------------------------

test("zero is a rating, not the absence of one", () => {
  // The judgment that matters most: the detector should not have
  // surfaced this. Treating it as unrated would drop it from the data.
  assert.equal(ratedOf(pt({ rating: 0 })), "rated");
  assert.equal(hasRating(pt({ rating: 0 })), true);
});

test("null and undefined are both unrated", () => {
  assert.equal(ratedOf(pt({ rating: null })), "unrated");
  assert.equal(ratedOf(pt({})), "unrated");
});

// --- visibility -------------------------------------------------------

test("all three axes must admit a point", () => {
  const p = pt({ rating: 4 });               // dr, detected, rated
  assert.equal(isVisible(p, filters()), true);
  assert.equal(isVisible(p, filters({ dr: false })), false);
  assert.equal(isVisible(p, filters({ detected: false })), false);
  assert.equal(isVisible(p, filters({ rated: false })), false);
});

test("visual references are hidden by default", () => {
  assert.equal(isVisible(pt({ cross_track_nm: 3, rating: 4 }), filters()), false);
  assert.equal(isVisible(pt({ cross_track_nm: 3, rating: 4 }), filters({ visual: true })), true);
});

test("the view that exists for finding what the detector missed", () => {
  const missed = pt({ source: "added", rating: 4 });
  const found = pt({ source: "detected", rating: 4 });
  const only = filters({ detected: false });
  assert.equal(isVisible(missed, only), true);
  assert.equal(isVisible(found, only), false);
});

// --- ordering ---------------------------------------------------------

const route = {
  endpoints: [
    { endpoint: true, along_track_nm: 0, ident: "C81" },
    { endpoint: true, along_track_nm: 300, ident: "KDLH" },
  ],
  detections: [pt({ along_track_nm: 150, rating: 4 }), pt({ along_track_nm: 50, rating: 4 })],
  added: [pt({ along_track_nm: 100, source: "added", rating: 5 })],
};

test("points come back in the order you fly them", () => {
  const order = orderedPoints(route, filters()).map(x => x.d.along_track_nm);
  assert.deepEqual(order, [0, 50, 100, 150, 300]);
});

test("the endpoints are the ends", () => {
  const walk = orderedPoints(route, filters());
  assert.equal(walk[0].d.ident, "C81");
  assert.equal(walk.at(-1).d.ident, "KDLH");
});

test("endpoints survive a filter that would exclude them", () => {
  // They are the ends of the leg, not entries in it, so no combination
  // of checkboxes should be able to leave the walk without a start.
  const walk = orderedPoints(route, filters({ dr: false, visual: false }));
  assert.equal(walk.length, 2);
  assert.equal(walk[0].d.ident, "C81");
});

test("a filtered-out point is not steppable", () => {
  const walk = orderedPoints(route, filters({ added: false }));
  assert.equal(walk.some(x => x.d.source === "added"), false);
});

test("a point with no along-track distance is left out rather than sorted to zero", () => {
  const unplaced = { ...pt({ rating: 4 }), along_track_nm: null };
  const walk = orderedPoints({ ...route, added: [unplaced] }, filters());
  assert.equal(walk.length, 4);
});

// --- arrow direction --------------------------------------------------

test("arrows follow the course across the screen", () => {
  // C81->KDLH bears 328: flying it goes up and to the left, and both of
  // those keys should step forward.
  assert.equal(forwardIsUp(328), true);
  assert.equal(forwardIsLeft(328), true);
});

test("a southeasterly course reverses both", () => {
  assert.equal(forwardIsUp(135), false);
  assert.equal(forwardIsLeft(135), false);
});

test("bearings outside 0-360 wrap", () => {
  assert.equal(forwardIsUp(688), forwardIsUp(328));
  assert.equal(forwardIsLeft(-32), forwardIsLeft(328));
});

// --- hidden count -----------------------------------------------------

test("hidden picks are counted once, not once per failing axis", () => {
  // A visual, added, rated pick fails three boxes at once. It is one
  // pick hidden, and reporting it three times is what the per-axis
  // breakdown used to do.
  const awkward = pt({ cross_track_nm: 3, source: "added", rating: 4 });
  assert.equal(hiddenCount([awkward], filters({ added: false })), 1);
});

test("nothing hidden when everything is ticked", () => {
  const all = Object.fromEntries(FILTER_KEYS.map(k => [k, true]));
  assert.equal(hiddenCount([pt({ rating: 4 }), pt({ cross_track_nm: 9 })], all), 0);
});
