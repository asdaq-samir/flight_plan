import { describe, expect, test } from "vitest";
import { rootSize } from "./dynamicType";

describe("following the iPhone's text size", () => {
  test("the default size keeps the browser's 16", () => {
    expect(rootSize(17, 402)).toBe(16);
  });

  test("a larger size scales the root with it", () => {
    // xLarge: Body 19.
    expect(rootSize(19, 440)).toBeCloseTo(17.88, 2);
  });

  test("a smaller size scales it down, as far as Small", () => {
    // Small: Body 15. xSmall's 14 would put the notes under 11.
    expect(rootSize(15, 402)).toBeCloseTo(14.12, 2);
    expect(rootSize(14, 402)).toBeCloseTo(14.12, 2);
  });

  test("never past what the narrowest layout's 20rem fits across the screen", () => {
    // An SE (375 wide) at xxxLarge, Body 23: 21.6 asked, 18.75 held.
    expect(rootSize(23, 375)).toBeCloseTo(18.75, 2);
  });
});
