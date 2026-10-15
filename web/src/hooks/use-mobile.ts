import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Whether the window is a phone's width. shadcn's generated hook, read
 * as the page renders rather than set in an effect after it: its first
 * render said "not a phone", and on an iPhone that first frame was
 * painted -- the map's panel drawn as a desktop's card, white and the
 * screen's width, then eased into the phone's pill (the owner's "on a
 * fresh load, the tabs seem to move down to a pill", seen frame by frame
 * in their screen recording).
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
