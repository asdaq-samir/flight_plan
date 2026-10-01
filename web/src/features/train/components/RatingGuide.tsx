import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Badge } from "../../../components/ui/badge";
import { Kbd } from "../../../components/ui/kbd";
import type { Rating } from "../../../lib/api/types";
import { inkOn } from "../../../lib/scoreScale";
import { COLORS } from "../logic";

/** Two keys, and everything else is a button -- the zoom on the map,
 *  Remove in the point's own popup, the filters in this drawer. */
const SHORTCUTS: [string | null, string][] = [
  ["↑↓", "step through the points, in flight order"],
  ["0–5", "rate the one you are on, and move to the next"],
  [null, "click the course to add a point"],
];

const SCALE: [Rating, string, string][] = [
  [0, "Not a feature.", "Contour, boundary, chart text. The detector is wrong."],
  [1, "", "Real, but you’d never use it. One creek among a dozen."],
  [2, "", "You’d have to hunt, and might not be sure you found it."],
  [3, "", "Workable. Findable, but confusable with something nearby."],
  [4, "", "You’d expect to spot it and be confident."],
  [5, "", "Unmistakable. On the nav log without a second thought."],
];

/**
 * The rating scale and the keyboard shortcuts for rating: what a
 * developer reads before walking a route, under the Training tab's
 * steps (see DevPanel). Two grouped lists, as the rest of the console
 * is: the scale, a row a rating with its badge, the question it
 * answers above it and what matters most below; and the keys, a row
 * each with the key at its end, as iOS lists a shortcut. They were a
 * paragraph either side of the scale and a wrap of keys.
 */
export default function RatingGuide() {
  return (
    <div className="space-y-6">
      <ListGroup
        title="Rating scale"
        footer={<>0 vs 1 matters most: 0 means the detector should never have surfaced it, 1 that it&rsquo;s real but poor. Ignore spacing, since selection already keeps them apart, and judge at this zoom.</>}
      >
        <ListRow
          title={<span className="italic">Flying this leg, would I look up and know <i className="not-italic font-semibold">that&rsquo;s the one</i>, not one like it?</span>}
        />
        {SCALE.map(([n, lead, text]) => (
          <ListRow
            key={n}
            media={<Badge className="w-6 justify-center px-0" style={{ backgroundColor: COLORS[n], color: inkOn(COLORS[n]) }}>{n}</Badge>}
            title={<span>{lead && <b>{lead}</b>} {text}</span>}
          />
        ))}
      </ListGroup>
      <ListGroup title="Keys">
        {SHORTCUTS.map(([key, text]) => (
          <ListRow key={text} title={text.charAt(0).toUpperCase() + text.slice(1)}>
            {key && <Kbd className="whitespace-nowrap">{key}</Kbd>}
          </ListRow>
        ))}
      </ListGroup>
    </div>
  );
}
