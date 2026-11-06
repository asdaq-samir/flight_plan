import { cn } from "cn";
import CardIdent from "./CardIdent";
import { CARD_GAP, CardMark, CardThread, EmptyMark, POINT_CARD } from "./routeCard";

/**
 * FPL's two lines before there is a route, where the route is changed in
 * the plan (lib/preferences RouteEdit "plan"), at the owner's pick of the
 * FPL canvas (2026-11-05, option 3 as cards: "On the plan should ask for
 * depart and destination on two lines, no n number or altitude"): the
 * departure and the destination each a card, as the plan's points are
 * once there is a route, on its dashed line; each a text box, the ident
 * typed in. The airplane, the altitude and the route's buttons
 * come with the route, over its Routes.
 */
export default function RouteEnds({ dep, dest, onDep, onDest }: {
  dep: string;
  dest: string;
  onDep: (ident: string) => void;
  onDest: (ident: string) => void;
}) {
  // The plan's own cards (routeCard), at the owner's ask (2026-11-05: "Make
  // these cards look similar to the ones when populated"): its card, its
  // mark's grey disc, its ident's box the ident's width, and the course's
  // line outside the cards' left edge into each mark.
  return (
    <ol className="flex min-w-0 flex-1 flex-col pt-1 pb-2 pl-0" aria-label="The route" data-testid="route-ends">
      <EndCard value={dep} onChange={onDep} label="Departure" testId="route-end-departure" first />
      <EndCard value={dest} onChange={onDest} label="Destination" testId="route-end-destination" />
    </ol>
  );
}

function EndCard({ value, onChange, label, testId, first = false }: {
  value: string;
  onChange: (ident: string) => void;
  label: string;
  testId: string;
  first?: boolean;
}) {
  return (
    <li className={cn("relative isolate flex min-h-16 items-center gap-2.5", POINT_CARD, first && CARD_GAP)}>
      <CardThread first={first} last={!first} />
      {/* The airport symbol on the marks' grey, faded, at the owner's ask
          (2026-11-05: "The stop icons can be airport like when empty"). */}
      <span className="grid w-7 shrink-0 place-items-center" aria-hidden="true">
        <CardMark><EmptyMark /></CardMark>
      </span>
      {/* A text box, as every card's ident is (CardIdent), at the owner's
          ask (2026-11-05: "Even the start can be consistent with it to
          have editable cards"); its placeholder in the words' own case. */}
      <div className="flex min-w-0 flex-1 pr-1.5">
        <CardIdent value={value} onCommit={onChange} placeholder={label} label={label} testId={testId} />
      </div>
    </li>
  );
}
