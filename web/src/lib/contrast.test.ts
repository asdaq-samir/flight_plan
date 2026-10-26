import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, over, parseColour, tokensOf, type Linear } from "./contrast";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

const colour = (v: string): Linear => {
  const c = parseColour(v);
  if (!c) throw new Error(`not a colour: ${v}`);
  return c;
};

describe("contrast", () => {
  it("measures WCAG's ratio: black on white 21, #767676 on white just past 4.5", () => {
    expect(contrast(colour("#000000"), colour("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrast(colour("#767676"), colour("#ffffff"))).toBeCloseTo(4.54, 2);
    expect(contrast(colour("#ffffff"), colour("#767676"))).toBeCloseTo(4.54, 2);
  });

  it("reads oklch as the browser does: white, black and iOS's blue", () => {
    expect(contrast(colour("oklch(1 0 0)"), colour("#ffffff"))).toBeCloseTo(1, 3);
    expect(contrast(colour("oklch(0 0 0)"), colour("#000000"))).toBeCloseTo(1, 3);
    // The light theme's tint, iOS's #0066CC a step deeper: 5.6:1 on white.
    expect(contrast(colour("oklch(0.522 0.177 255.8)"), colour("#ffffff"))).toBeCloseTo(5.6, 1);
  });

  it("composites a wash over its surface", () => {
    const grey = over(colour("#000000"), 0.5, colour("#ffffff"));
    expect(contrast(grey, colour("#ffffff"))).toBeCloseTo(contrast(colour("#808080"), colour("#ffffff")), 1);
  });
});

describe("the night theme's tokens (index.css .dark)", () => {
  const dark = tokensOf(css, ".dark");
  const light = tokensOf(css, ":root");
  const t = (name: string) => colour(dark[name] ?? light[name] ?? "");

  it("is the cockpit palette's navy", () => {
    expect(dark["--background"]).toBe("#0b1422");
    expect(dark["--card"]).toBe("#17283a");
  });

  const surfaces = ["--background", "--card", "--popover", "--muted"];
  const words = [
    "--foreground", "--muted-foreground", "--tint", "--caution", "--go", "--go-ink",
    "--destructive", "--procedure", "--airspace-blue-text", "--airspace-magenta-text",
  ];
  for (const word of words) {
    for (const surface of surfaces) {
      it(`${word} reads 4.5:1 or more on ${surface}`, () => {
        expect(contrast(t(word), t(surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white words on the tint's fill, and caution's words on its wash, 4.5:1 or more", () => {
    expect(contrast(t("--primary-foreground"), t("--primary"))).toBeGreaterThanOrEqual(4.5);
    const washToken = light["--caution-wash"] ?? "";
    const wash = washToken.replace(/\s*\/\s*([\d.]+)%\)/, ")");
    const alpha = Number(/\/\s*([\d.]+)%/.exec(washToken)?.[1]) / 100;
    expect(contrast(t("--caution-ink"), over(colour(wash), alpha, t("--card")))).toBeGreaterThanOrEqual(4.5);
  });

  it("the focus ring 3:1 or more on every surface (WCAG 1.4.11)", () => {
    for (const surface of surfaces) expect(contrast(t("--ring"), t(surface))).toBeGreaterThanOrEqual(3);
  });
});
