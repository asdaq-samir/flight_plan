import type { ReactNode } from "react";
import { CardHead } from "../../../components/PanelCard";

/**
 * The route from the side, a card over FPL as the Brief and the nav log
 * are, opened from its button beside the nav log's, at the owner's ask
 * ("profile view can move next to the navlog button and open like brief
 * and navlog opens instead of the swipe"): the side view (MiniProfile) the
 * card's height, its Dry run at its top right, the route's figures under
 * it at the sheet's foot.
 */
export default function ProfileCard({ line, onClose, children }: {
  /** Under the name: the route. */
  line: ReactNode;
  onClose: () => void;
  /** The side view, with its Dry run. */
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] print:hidden" data-testid="profile-card">
      <CardHead name="Profile" line={line} nameTestId="profile-name" onClose={onClose} closeTestId="profile-close" />
      <div className="mt-3 flex min-h-40 flex-1 flex-col [&_[data-testid=mini-profile]]:h-full">{children}</div>
    </div>
  );
}
