/**
 * WCAG 2's contrast ratio between two of the theme's colours, as the
 * iOS audit's P15 measures it on the page: a test reads index.css's
 * tokens through this and holds every pair of words and surface to 4.5:1
 * (WCAG 1.4.3), so a retuned token that drops below it fails a test, not
 * a pilot at night.
 *
 * Reads the two forms the tokens are written in, `#rrggbb` and
 * `oklch(L C h)` (alpha ignored), and a few named mixes are composited
 * by the caller with `over`.
 */

/** A colour as linear-light sRGB, each channel 0 to 1. */
export type Linear = [number, number, number];

const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (c: number) => Math.min(1, Math.max(0, c));

/** Björn Ottosson's OKLab to linear sRGB, the matrices CSS Color 4 uses,
 *  clipped to the sRGB gamut as a browser draws an out-of-gamut colour. */
function fromOklch(l: number, c: number, h: number): Linear {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

/** A token's value as linear sRGB, or null where it is neither form. */
export function parseColour(value: string): Linear | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [decode(((n >> 16) & 255) / 255), decode(((n >> 8) & 255) / 255), decode((n & 255) / 255)];
  }
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (ok) return fromOklch(Number(ok[1]), Number(ok[2]), Number(ok[3]));
  return null;
}

/** WCAG 2's relative luminance. */
export const luminance = ([r, g, b]: Linear) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG 2's contrast ratio, 1 to 21, the lighter over the darker. */
export function contrast(a: Linear, b: Linear): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `fg` at `alpha` over `bg`, blended in encoded sRGB as a browser does. */
export function over(fg: Linear, alpha: number, bg: Linear): Linear {
  return fg.map((f, i) => decode(encode(f) * alpha + encode(bg[i]!) * (1 - alpha))) as Linear;
}

/** The custom properties a block of index.css sets, `--name` to value:
 *  the block whose selector is `selector` (":root", ".dark"). */
export function tokensOf(css: string, selector: string): Record<string, string> {
  const at = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  if (at < 0) return {};
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}
