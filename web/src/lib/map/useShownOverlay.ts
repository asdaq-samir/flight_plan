import { useQuery } from "@tanstack/react-query";
import { googleMapsQuery } from "../queryClient";
import { usePreferences, type MapOverlay } from "../preferences";

/**
 * The overlay as it can be drawn: the saved choice, except that a Google
 * one is none where the deployment has no key (removed since, or the key
 * request failed, as offline), so the settings and the map agree and no
 * control is left with a value it has no option for.
 */
export function useShownOverlay(): MapOverlay {
  const overlay = usePreferences(s => s.overlay);
  const { data: google, isPending } = useQuery(googleMapsQuery);
  return overlay.startsWith("google") && !google && !isPending ? "none" : overlay;
}
