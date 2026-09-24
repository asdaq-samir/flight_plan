import type L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";

/**
 * Which marker's own popup is open, so its hover tooltip doesn't sit
 * drawn behind the card a tap just opened -- a tap fires mouseover
 * before click, and the pointer is usually still over the marker once
 * the card is up. Shared by every layer that pairs a hover-preview
 * tooltip with a tap-to-open popup child of the same marker.
 *
 * The close is heard on the map, not the marker. react-leaflet takes a
 * marker's event handlers off before it removes the marker, and removing
 * it is what closes its popup -- so a marker that unmounted with its card
 * open (zoomed out past the markers zoom, a layer switched off) fired its
 * `popupclose` at nobody, and its hover preview stayed off until some
 * other card opened and closed. The map still hears it.
 */
export function useCardedMarker<Id = string>() {
  const map = useMap();
  const [carded, setCarded] = useState<Id | null>(null);
  const open = useRef<L.Popup | null>(null);

  useEffect(() => {
    const onClose = (event: L.PopupEvent) => {
      if (event.popup !== open.current) return;
      open.current = null;
      setCarded(null);
    };
    map.on("popupclose", onClose);
    return () => {
      map.off("popupclose", onClose);
    };
  }, [map]);

  const cardEvents = useCallback((id: Id) => ({
    popupopen: (event: L.PopupEvent) => {
      open.current = event.popup;
      setCarded(id);
    },
  }), []);
  return { carded, cardEvents };
}
