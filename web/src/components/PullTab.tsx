import type { ReactNode } from "react";

interface Props {
  /** Which way the handle it belongs to drags -- the grip mark turns
   *  90° between the two, but the shape is the same pill either way. */
  orientation: "vertical" | "horizontal";
  /** A label, shown alongside the grip mark rather than replacing it --
   *  optional, since the sidebar's version only shows one once it's
   *  narrow enough that the panel itself can't say what it is. */
  children?: ReactNode;
  /** "slate" (the default, every existing drag handle) or "red" -- the
   *  error drawer's own handle, so it reads as the failure one rather
   *  than another settings drawer to pull. */
  tone?: "slate" | "red";
}

const TONE = {
  slate: { capsule: "border-slate-300 bg-slate-50", grip: "bg-slate-300" },
  red: { capsule: "border-red-400 bg-red-800", grip: "bg-red-400" },
};

/**
 * The grip capsule every drag handle in this app shows, so pulling the
 * sidebar and pulling the toolbar read as the same gesture rather than
 * two components that happened to end up looking different. Purely
 * presentational -- sizes to its content rather than a fixed box (so a
 * label fits), and dragging itself is wired by whoever renders it.
 */
export default function PullTab({ orientation, children, tone = "slate" }: Props) {
  const vertical = orientation === "vertical";
  const { capsule, grip } = TONE[tone];
  return (
    <div
      // A little cross-axis padding, not none: at zero, `rounded-full`
      // has almost no height left to curve into, so the top and bottom
      // of the pill read as two flat lines around the text rather than
      // a rounded shape -- this is the least padding that still looks
      // like a capsule instead of degenerating into that.
      //
      // py-3, not py-2: the pill's own corner radius is half its
      // (narrow, fixed) cross-axis size -- about 11px here -- so
      // padding any less than that on the main axis starts the content
      // area before the corner has actually finished curving, and a
      // long label (a waypoint count with two or three digits) reads
      // as crowding into the rounded cap instead of clearing it.
      className={`flex items-center justify-center rounded-full border shadow-sm ${capsule} ${
        vertical ? "flex-col gap-1 px-0.5 py-3" : "flex-row gap-1 px-3 py-0.5"
      }`}
    >
      <div className={`flex-shrink-0 rounded-full ${grip} ${vertical ? "h-8 w-1" : "h-1 w-8"}`} />
      {children}
    </div>
  );
}
