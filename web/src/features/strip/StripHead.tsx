import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import FindingIcon from "../../components/FindingIcon";
import { Button } from "../../components/ui/button";
import type { GlanceLine } from "../../lib/glance";
import { FINDING_TONE, type Finding } from "../../lib/status";
import { TEXT } from "../../lib/text";

/** A card of the strip: 18-point corners, white on the sheet's grey, a
 *  hair of shadow (the canvas's boards). */
export const STRIP_CARD = "rounded-[18px] bg-card shadow-[0_1px_4px_rgb(0_0_0/0.08)]";

/**
 * The strip's head: the verdict -- go, caution or no-go, in the Brief's
 * words (lib/verdict) -- over the destination's aerial photo (the
 * planner's airport-aerial, a scrim under the words; the paper where it
 * has none), the route's line under it in condensed capitals ("C81 →
 * KJVL → KDLH · C172 · FL045 · leaving 14:10"), and at most three
 * one-line actions from the glance (lib/glance's `act`), each a row into
 * the Brief. The route's menu (Share, Save, Plan again, File) at the
 * head's corner, where the tabs' route box had it.
 */
export default function StripHead({ dest, verdict, line, actions, onAction, onBrief, menu, ways, wayKey, onWay }: {
  dest: string;
  verdict: { finding: Finding; words: string } | null;
  line: string | null;
  actions: GlanceLine[];
  onAction: (line: GlanceLine) => void;
  onBrief: () => void;
  menu?: ReactNode;
  /** The route's other ways (FPL's Routes, the planner's chips): each a
   *  chip, the one flown filled; a tap plans it. */
  ways?: { key: string; label: string }[];
  wayKey?: string;
  onWay?: (key: string) => void;
}) {
  // The photo as it comes: none until the planner answers, and none for
  // good where it has no aerial for the field (a 404).
  const [photo, setPhoto] = useState<"loading" | "shown" | "none">("loading");
  const pictured = photo === "shown";
  return (
    <section className="flex flex-col gap-2" aria-label="The flight" data-testid="strip-head">
      <div className={cn("relative overflow-hidden", STRIP_CARD, pictured ? "text-white" : "bg-card")} data-testid="strip-head-card" data-photo={photo}>
        {dest && photo !== "none" && (
          <img
            src={`/api/planner/airport-aerial/${encodeURIComponent(dest)}.jpg`} alt="" aria-hidden="true"
            className={cn("absolute inset-0 size-full object-cover", !pictured && "invisible")}
            onLoad={() => setPhoto("shown")} onError={() => setPhoto("none")}
          />
        )}
        {pictured && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/10" aria-hidden="true" />}
        <div className="relative flex min-h-28 flex-col justify-end gap-1.5 p-4">
          {menu && <div className="absolute top-2 right-2">{menu}</div>}
          {verdict ? (
            <button
              type="button" onClick={onBrief} data-testid="strip-verdict" data-finding={verdict.finding}
              className="flex items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FindingIcon finding={verdict.finding} className={cn("size-6", pictured && "text-white")} />
              <span className={cn("font-bold", TEXT.heading, pictured ? "text-white" : FINDING_TONE[verdict.finding])}>{verdict.words}</span>
            </button>
          ) : (
            <span className={cn("font-bold", TEXT.heading, !pictured && "text-muted-foreground")} role="status" data-testid="strip-verdict-pending">Reading the brief…</span>
          )}
          {line && (
            <p className={cn("font-stretch-condensed truncate uppercase tracking-wide", TEXT.note, pictured ? "text-white/90" : "text-muted-foreground")} data-testid="strip-head-line">
              {line}
            </p>
          )}
        </div>
      </div>
      {ways && ways.length > 1 && onWay && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" data-testid="strip-ways" role="group" aria-label="The route's ways">
          {ways.map(w => (
            <Button
              key={w.key} size="sm" variant={w.key === wayKey ? "default" : "outline"} data-testid={`strip-way-${w.key}`} data-state={w.key === wayKey ? "on" : "off"}
              className={cn("relative h-8 shrink-0 rounded-full after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']", w.key !== wayKey && "border-tint text-tint", TEXT.detail)}
              onClick={() => onWay(w.key)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      )}
      {actions.map(a => (
        <button
          key={a.key} type="button" onClick={() => onAction(a)} data-testid={`strip-action-${a.key}`} data-finding={a.finding}
          className={cn("flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", STRIP_CARD)}
        >
          <FindingIcon finding={a.finding} className="size-5 shrink-0" />
          <span className={cn("min-w-0 flex-1 font-medium", TEXT.row)}>{a.line}</span>
          <ChevronRight className="size-5 shrink-0 text-tint" aria-hidden />
        </button>
      ))}
    </section>
  );
}
