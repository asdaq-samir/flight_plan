import type { ReactNode } from "react";
import { Plane } from "lucide-react";
import { cn } from "cn";
import TabPage from "../../components/TabPage";
import type { BriefGlance, GlanceLine } from "../../lib/glance";
import type { Finding } from "../../lib/status";
import { TEXT } from "../../lib/text";
import type { NavLogRow } from "../plan/components/navlog/rows";
import StripHead, { STRIP_CARD } from "./StripHead";
import StripList from "./StripList";

/**
 * The sheet's content in the strip layout (MapPanel's children): with a
 * route, the head -- the verdict over the destination's photo, the
 * route's line, the actions -- and the timeline under it (StripHead,
 * StripList); with none, the first flight's welcome and nothing else,
 * the field at the foot being the way in. The existing cards -- an
 * airport's, the Brief, the nav log, the profile, the stops -- open over
 * it as they open over the tabs (PlanWorkspace).
 */
export default function StripSheet({ routed, dest, verdict, line, actions, onAction, onBrief, menu, rows, depart, glance, onField, onPlates, onClearance, onCheckpoint, after, ways, wayKey, onWay, altitude }: {
  routed: boolean;
  dest: string;
  verdict: { finding: Finding; words: string } | null;
  line: string | null;
  actions: GlanceLine[];
  onAction: (line: GlanceLine) => void;
  onBrief: () => void;
  menu?: ReactNode;
  rows: NavLogRow[];
  depart: string;
  glance: BriefGlance | null;
  onField: (ident: string) => void;
  onPlates: (ident: string) => void;
  onClearance: () => void;
  onCheckpoint: (lat: number, lon: number) => void;
  after?: ReactNode;
  ways?: { key: string; label: string }[];
  wayKey?: string;
  onWay?: (key: string) => void;
  /** The altitude's row under the head (StripHead). */
  altitude?: { words: string; onOpen: () => void } | null;
}) {
  if (!routed) {
    return (
      <TabPage testId="strip-welcome">
        <section aria-labelledby="strip-welcome-title" className={cn("flex flex-col gap-2 p-4", STRIP_CARD)}>
          <div className="flex items-center gap-2.5">
            <Plane className="size-6 shrink-0 text-tint" aria-hidden />
            <h2 id="strip-welcome-title" className={cn("font-semibold", TEXT.heading)}>Where to?</h2>
          </div>
          <p className={cn("text-foreground/80", TEXT.prose)}>
            Type or say a field, a town or a route below. Wingtip plans from where you are: the route, the checkpoints you'll see from the air, the nav log and a weather brief, all on one strip.
          </p>
        </section>
      </TabPage>
    );
  }
  return (
    <TabPage testId="strip-sheet">
      <div className="flex flex-col gap-3">
        <StripHead dest={dest} verdict={verdict} line={line} actions={actions} onAction={onAction} onBrief={onBrief} menu={menu} ways={ways} wayKey={wayKey} onWay={onWay} altitude={altitude} />
        <StripList rows={rows} depart={depart} glance={glance} onField={onField} onPlates={onPlates} onClearance={onClearance} onCheckpoint={onCheckpoint} after={after} />
      </div>
    </TabPage>
  );
}
