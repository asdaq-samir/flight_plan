import type { ReactNode } from "react";
import { CardHead } from "../../../components/PanelCard";
import PanelTabs from "./navlog/PanelTabs";
import BriefGlance from "./briefing/BriefGlance";
import type { PanelTab } from "./navlog/panelTab";

/**
 * FPL's Brief, a card over it as an airport's is, at the owner's ask ("we
 * can have a brief button which can open a new brief card to have
 * everything preflight, depart, enroute, arrive. But FPL is simple with
 * route, navlog, profile and calculations"): the route's name and its plan
 * at its head (CardHead), then whether to go and a card for each part of
 * the flight (BriefGlance, the owner's pick of the redesign, D′), each
 * opening its page (PanelTabs) -- Preflight, Depart, En route, the legs
 * left to FPL, and Arrive -- the close going back from a page to the
 * cards. On paper the briefing is FPL's, every page after the legs
 * (NavLogView).
 */
export default function BriefCard({ name, line, contents, notice, marks, onClose, onTap, onLegs, route }: {
  name: ReactNode;
  /** Under the name: where from and to, the airplane, the altitude, when. */
  line: ReactNode;
  contents: Record<PanelTab, ReactNode>;
  /** The briefing's warnings, over every page. */
  notice?: ReactNode;
  /** Pages with something to fix (red) or to look at (amber). */
  marks?: Partial<Record<PanelTab, "stop" | "caution">>;
  onClose: () => void;
  /** A page's tab tapped (PanelTabs' `onTap`). */
  onTap: (again: boolean) => void;
  /** The legs asked for from a page: FPL's nav log in place of the card. */
  onLegs: () => void;
  route: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col print:hidden" data-testid="brief-card">
      <PanelTabs
        printing={false} marks={marks} route={route} notice={notice} contents={contents} onTap={onTap} onLegs={onLegs}
        overview={BriefGlance}
        before={(
          <div className="px-4 pt-[var(--corner-inset,0.75rem)]">
            <CardHead name={name} line={line} nameTestId="brief-name" lineTestId="brief-line" onClose={onClose} onShare="brief" closeTestId="brief-close" />
          </div>
        )}
      />
    </div>
  );
}
