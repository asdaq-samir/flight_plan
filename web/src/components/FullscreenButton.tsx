import { Maximize } from "lucide-react";
import IconButton from "./IconButton";

/** Whether this browser will actually take an element full screen.
 *  `fullscreenEnabled` is the standard's own "is this allowed here"
 *  flag, and it is what tells an iPad (where the API works) from an
 *  iPhone (where it does not, per WebKit's own compatibility data) --
 *  the method itself may exist on both. */
function fullscreenWorks(): boolean {
  return typeof document !== "undefined"
    && typeof document.documentElement.requestFullscreen === "function"
    && !!document.fullscreenEnabled;
}

/**
 * Full screen for the whole app, on the map's own control stack: a
 * chart is the one thing here that wants every pixel, and in a browser
 * tab the header and the address bar are the two that take them.
 *
 * It draws itself only where it would work, which is a desktop browser
 * and an iPad. On an iPhone Safari refuses the Fullscreen API outright
 * for anything but a video, so the button is simply absent there
 * rather than present and broken -- an iPhone's way to the whole
 * screen is adding the app to the Home Screen, which the pilot guide
 * explains. Where it does work, Safari adds its own undismissable
 * close button and a swipe down leaves, which is the platform's
 * choice, not ours.
 *
 * The map re-measures itself on the way in and out without being told:
 * `ResizeAware` watches the container, and going full screen resizes
 * it like any other layout change.
 */
export default function FullscreenButton() {
  if (!fullscreenWorks()) return null;
  return (
    <IconButton
      label="Full screen"
      variant="outline"
      className="bg-background shadow-sm"
      onClick={() => { void document.documentElement.requestFullscreen(); }}
      data-testid="fullscreen-button"
    >
      <Maximize className="size-5" />
    </IconButton>
  );
}
