import { useSyncExternalStore } from "react";

/** An iPad, full screen or in a half of Split View wide enough: a touch
 *  screen of iOS's regular width and height, where a sheet is the centred
 *  card iOS calls a form sheet rather than a phone's sheet stretched
 *  across it. A phone on its side is as wide but not as tall, and keeps
 *  the phone's presentation; a mouse keeps the desktop's. */
const TABLET = "(pointer: coarse) and (min-width: 744px) and (min-height: 600px)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(TABLET);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export function useIsTablet() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(TABLET).matches, () => false);
}
