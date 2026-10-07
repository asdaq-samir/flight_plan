import StatusBadge from "../../../../components/StatusBadge";
import { colourOf } from "../../../../lib/map/flightCategory";

/** A flight category as the app's status badge, its dot in the
 *  category's own colour. It was a badge filled in the colour with white
 *  letters, LIFR's magenta 3.2:1 under them. */
export default function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  return <StatusBadge color={colourOf(category)}>{category}</StatusBadge>;
}
