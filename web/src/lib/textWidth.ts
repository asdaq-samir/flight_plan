let context: CanvasRenderingContext2D | null | undefined;

/** Words' width in a CSS font ("600 17px Inter Variable"), measured on a
 *  canvas rather than laid out: a checkpoint's label kept clear of the
 *  next (icons.ts), the route's name cut to fit its capsule
 *  (PanelCapsule). Null where there is no canvas to measure on. */
export function textWidth(text: string, font: string): number | null {
  context ??= typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = font;
  return context.measureText(text).width;
}
