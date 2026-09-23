import { useCallback, useState } from "react";

/**
 * Which marker's own popup is open, so its hover tooltip doesn't sit
 * drawn behind the card a tap just opened -- a tap fires mouseover
 * before click, and the pointer is usually still over the marker once
 * the card is up. Shared by every layer that pairs a hover-preview
 * tooltip with a tap-to-open popup child of the same marker (first
 * written for Class B, now every marker on both maps).
 */
export function useCardedMarker<Id = string>() {
  const [carded, setCarded] = useState<Id | null>(null);
  const cardEvents = useCallback((id: Id) => ({
    popupopen: () => setCarded(id),
    popupclose: () => setCarded(current => (current === id ? null : current)),
  }), []);
  return { carded, cardEvents };
}
