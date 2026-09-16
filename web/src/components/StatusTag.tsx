import type { ReactNode } from "react";

/** A soft, low-emphasis status label -- "promoted," "low" ceiling,
 *  anything worth flagging inline without the weight of `Badge`'s
 *  solid-color pill (that one's for ratings/scores, a value someone
 *  is meant to compare; this one's a one-word annotation). Two tones
 *  cover what this project actually needs so far. */
const TONES = {
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
} as const;

export default function StatusTag({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${TONES[tone]}`}>{children}</span>;
}
