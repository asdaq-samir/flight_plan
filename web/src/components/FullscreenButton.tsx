import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
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
  // Read once during render rather than in an effect: this is a fact
  // about the browser, not state to synchronise, and an effect that
  // set it would cascade a second render on every mount.
  const [works, setWorks] = useState(fullscreenWorks);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  if (!works) return null;
  return (
    <IconButton
      label={on ? "Leave full screen" : "Full screen"}
      variant="outline"
      className="bg-background shadow-sm"
      onClick={() => {
        if (on) { void document.exitFullscreen().catch(() => { /* already out */ }); return; }
        // A refusal means this browser said yes to `fullscreenEnabled`
        // and no to the request; take the button away rather than
        // leave one that does nothing.
        void document.documentElement.requestFullscreen().catch(() => setWorks(false));
      }}
      data-testid="fullscreen-button"
    >
      {on ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
    </IconButton>
  );
}
