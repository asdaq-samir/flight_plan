import { describe, expect, it } from "vitest";

// Words a pilot reads (a caution on an altitude, a sign-in error, a
// weather category) take their size from TEXT, which sets 15 and 13
// points on a touch screen; a raw text-sm or text-xs stayed 14 and 12
// on the phone (the design audit, 2026-10-08).
const FILES = [
  "features/plan/components/PointAltitudeDialog.tsx",
  "features/pilot/SignInModal.tsx",
  "features/pilot/LinkSignIn.tsx",
  "features/plan/components/PlaceCard.tsx",
  "lib/map/AirportCard.tsx",
  "components/AccordionSection.tsx",
];

const SOURCES = import.meta.glob("/src/**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("the type scale", () => {
  it.each(FILES)("%s sets no raw text size", file => {
    const source = SOURCES[`/src/${file}`];
    expect(source).toBeDefined();
    expect(source).not.toMatch(/\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/);
  });
});
