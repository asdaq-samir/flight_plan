import { cn } from "cn";

/**
 * Comms assist's mark: a pilot's headset with its boom mic, the thing a
 * pilot talks to the radio through, where a plain microphone read as
 * dictation (the owner, 2026-11-04: "let's redesign this mic icon a mic
 * for comms assist"). On lucide's 24-point grid with its 1.5-point line,
 * as the map's other buttons are drawn, in the text's colour.
 */
export default function CommsGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      className={cn("size-5", className)} aria-hidden="true"
    >
      {/* The headband over the top. */}
      <path d="M5 11.5v-0.75a7 7 0 0 1 14 0v0.75" />
      {/* The ear cups. */}
      <rect x="3" y="11.5" width="4" height="6" rx="1.75" />
      <rect x="17" y="11.5" width="4" height="6" rx="1.75" />
      {/* The boom from the left cup round to the mouth, and its mic. */}
      <path d="M5 17.5c0 1.6 1.4 2.5 3.6 2.5H11" />
      <rect x="11" y="18.5" width="3.25" height="3" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
