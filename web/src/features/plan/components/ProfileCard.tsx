import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { CardHead } from "../../../components/PanelCard";
import { TEXT } from "../../../lib/text";

/**
 * The route from the side, a card over FPL as the Brief and the nav log
 * are, opened from its button beside the nav log's, at the owner's ask
 * ("profile view can move next to the navlog button and open like brief
 * and navlog opens instead of the swipe"): the side view (MiniProfile) the
 * card's height, its Dry run at its top right, the route's figures under
 * it at the sheet's foot. Its bar's Share where Back was, the route's
 * Share menu, as the Brief's and the nav log's are, at the owner's ask
 * ("Profile needs the share instead of the back button like brief").
 */
export default function ProfileCard({ name, line, corner, cautions = [], onClose, children }: {
  /** Its head, as the Brief's is: the route's name, and under it where
   *  from and to, the airplane, the altitude and when -- the tab bar over
   *  it says "Profile" already (the owner's "titles appear twice"). */
  name: ReactNode;
  line: ReactNode;
  /** At the head's top right: the flight rules, VFR or IFR, with no label
   *  of its own, at the owner's ask ("Vfr switch can be on the top right
   *  corner, don't need the label flight rules"). */
  corner?: ReactNode;
  /** What the pilot's own altitude breaks, the planner's words with their
   *  rules (own_altitude_caution: over the airplane's service ceiling, the
   *  oxygen 14 CFR 91.211(a) asks: (a)(1) the crew past 30 minutes over
   *  12,500 ft MSL, (a)(2) the crew over 14,000, (a)(3) every occupant over
   *  15,000): said here under the head, where the
   *  Profile button's mark points, and in sight through a dry run, which
   *  puts the route's box and its altitude away. A warning, never a
   *  limit (the owner, 2026-10-23). */
  cautions?: string[];
  onClose: () => void;
  /** The side view, with its Dry run. */
  children: ReactNode;
}) {
  return (
    // Half way no taller than half's body (MapPanel's --half-body): the
    // sheet is laid out at its full height and cut off at its edge, so the
    // graph's max-h-full is the room in sight only with the card held to it.
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-[var(--corner-inset,0.75rem)] in-data-[panel=half]:max-h-(--half-body) print:hidden" data-testid="profile-card">
      <CardHead name={name} line={line} nameTestId="profile-name" onClose={onClose} onShare="profile" closeTestId="profile-close">{corner}</CardHead>
      {cautions.length > 0 && (
        <ul className={cn("mt-2 shrink-0 space-y-1 rounded-lg bg-caution-wash px-2.5 py-2 text-caution-ink", TEXT.detail)} data-testid="profile-cautions">
          {cautions.map(reason => (
            <li key={reason} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
      {/* As tall as the card has room for over the route's figures, no
          taller: held at 160, it ran under them where the name took two
          lines at the owner's larger text, the graph's foot behind the
          figures (the owner's screenshot); what it holds scrolls. Its
          skeleton as tall while the ground is fetched (MiniProfile). */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col [&_[data-testid=mini-profile-skeleton]]:h-full [&_[data-testid=mini-profile]]:h-full">{children}</div>
    </div>
  );
}
