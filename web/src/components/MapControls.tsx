import { lazy, Suspense } from "react";
import { cn } from "cn";
import { Button } from "./ui/button";
import FlownTrackButton from "./FlownTrackButton";
import FullscreenButton from "./FullscreenButton";
import MyPositionButton from "./MyPositionButton";
import MapSettingsButton from "./MapSettingsButton";
import RadioButton from "./RadioButton";
import { useAtcRadio } from "../lib/atcRadio";
import { useIsMobile } from "../hooks/use-mobile";
import { FLYING_BUTTON, FLYING_STACK, GLASS, useFlying } from "./mapChrome";

/**
 * The map's buttons, in one group floating over the chart, as Maps
 * stacks its own: the map's settings, the pilot's own position (the
 * location arrow), and full screen where it works. A zoom toggle, between the whole route and the
 * selected point, went: picking a waypoint brings the map to it. At the
 * bottom right, over the sheet or the panel's edge -- clear of it, and of
 * the chart credit in the corner.
 *
 * Ghost buttons on the group's glass, eight apart inside it, so
 * each one's 44-point hit area (index.css) meets the next one's rather
 * than overlapping it. Only the location arrow in the tint, as Maps'
 * is; the others' glyphs in the text's colour.
 *
 * In flight (useFlyingMode, the canvas's Flying screen, 2026-11-03) the
 * stack is two 60-point words a hand finds in turbulence -- NRST, the
 * fields nearest own ship, and D→, direct to the next landing -- and the
 * microphone's circle grows to the same size where it is; the settings,
 * the arrow and the rest wait for the ground. The map follows the
 * airplane in flight (OwnShipLayer), so the arrow is not missed.
 */
/** The microphone's pill, in RadioLayer's chunk with the rest of the
 *  radio's words: fetched as the mic is first tapped, never on the
 *  first load. */
const RadioPill = lazy(() => import("./RadioLayer").then(m => ({ default: m.RadioPill })));

export default function MapControls() {
  const flying = useFlying(s => s.flying);
  const nearest = useFlying(s => s.nearest);
  const direct = useFlying(s => s.direct);
  const pill = useAtcRadio(s => s.pill !== null);
  // The pill heard and done (its words or why not, its ✕ there): the mic
  // beside its close put away, at the owner's ask ("No mic button needed
  // next to close button on top", 2026-11-04); while it listens the mic
  // stays, its waveform saying so.
  const pillDone = useAtcRadio(s => s.pill !== null && !s.pill.listening);
  // On a phone the mic at the left over the tabs; from md up a button of
  // its own over the map's buttons at the right (the owner, 2026-11-06:
  // "move the headset button as a separate button on the right above
  // other floating buttons"), where it was a circle alone at the chart's
  // foot past the panel's edge. One of the two drawn, never both: the
  // radio's state is the one mic's.
  const onPhone = useIsMobile();
  const mic = (
    <div
      data-map-food=""
      className={cn(
        "z-[1000] flex items-end rounded-[26px] p-1",
        onPhone
          ? "absolute bottom-[calc(max(env(safe-area-inset-bottom),var(--sheet-cover,var(--map-inset-bottom,0px)))+1.5rem)] left-[calc(max(0.5rem,env(safe-area-inset-left))+var(--map-inset-left,0px))] max-w-[min(28rem,calc(100vw-5rem))]"
          // In the column at the right edge: widening to the left into
          // the pill, its mic staying where it was.
          : "max-w-[min(28rem,calc(100vw-30rem))] flex-row-reverse",
        GLASS,
      )}
      data-testid="mic-circle" data-listening={pill || undefined}
      // Riding the sheet's top (MapPanel's ride rule), on a phone.
      data-rides={onPhone || undefined}
    >
      {/* In flight the mic alone grows to 60 points (FLYING_BUTTON), not
          the pill's chips. */}
      <span className={cn("flex shrink-0 [&_button]:rounded-full", flying && "[&_button]:size-[60px]", pillDone && !flying && "hidden")}>
        <RadioButton />
      </span>
      <div className="grid min-w-0 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none" style={{ gridTemplateColumns: pill ? "1fr" : "0fr" }}>
        <div className="min-w-0 overflow-hidden">
          {pill && <Suspense fallback={null}><RadioPill /></Suspense>}
        </div>
      </div>
    </div>
  );
  return (
    <>
    {/* z-[1000]: over Leaflet's own panes, the level Leaflet gives its
        controls; still inside the map's own stacking context, under the
        panel and every portal. The map's right edge is the screen's, so
        clear of a landscape phone's notch there.
        Just over the sheet at its small and medium heights, as Maps' ride
        on its sheet (the owner's screenshot, 2026-10-26): the map's bottom
        inset is what the sheet covers at rest (MapPanel), and they move
        with it in the sheet's time; all the way up they give way
        (index.css). Clear of the chart credit under them. */}
    <div data-map-controls="" data-flying={flying || undefined} className="absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(max(env(safe-area-inset-bottom),var(--sheet-cover,var(--map-inset-bottom,0px)))+1.5rem)] md:nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] md:nav-bottom:bottom-auto z-[1000] flex flex-col items-end gap-2">
      {!onPhone && mic}
      <div
        className={cn(
          // A capsule of Liquid Glass, as Maps' buttons are on iOS 26 and
          // the panel's capsule is at rest: a circle round one button, a
          // pill round more, and no hairlines between them.
          // Round buttons on it, so one pressed or open is a circle in the
          // circle, not a square.
          "flex flex-col gap-2 rounded-full p-1 [&_button]:rounded-full",
          flying && FLYING_STACK,
          GLASS,
        )}
      >
        {flying ? (
          <>
            {nearest && (
              <Button type="button" variant="ghost" aria-label="Nearest airports" data-testid="flying-nearest" className={cn(FLYING_BUTTON, "text-[0.8125rem]")} onClick={nearest}>
                NRST
              </Button>
            )}
            {direct && (
              <Button type="button" variant="ghost" aria-label={`Direct to ${direct.to}`} data-testid="flying-direct" className={cn(FLYING_BUTTON, "text-base")} onClick={direct.go}>
                D→
              </Button>
            )}
            {/* The location arrow, 60 points as the rest: on the airplane,
                and in a dry run its other face the whole route (the
                owner's 2026-10-27 asks), which flying mode had put away
                (the owner's yes to the run's own controls back,
                2026-11-04). */}
            <MyPositionButton />
          </>
        ) : (
          <>
            {/* The map's settings first, as Maps' map button is. */}
            <MapSettingsButton />
            <MyPositionButton />
            {/* While a saved flight's flown track is on the chart. */}
            <FlownTrackButton />
            {/* Draws itself only where full screen actually works: a desktop
                browser and an iPad, never an iPhone. */}
            <FullscreenButton />
          </>
        )}
      </div>
    </div>
    {/* The radio's microphone (RadioButton) in a glass circle of its own
        at the left, level with the group, where the Stops were (it was
        Fly-in Food before them), at the owner's ask (2026-11-02), alone:
        the route's Play above it went to the route's ••• menu as Profile
        (2026-11-02, "just the mic"). The circle is the pill too: tapped,
        it widens to the right into the listening pill (RadioPill) with
        the mic's glyph become the waveform at its end, and shrinks back
        once the pill is put away -- the button and the pill were two
        things apart, one here and one at the top of the map (the owner,
        2026-11-03). The width eases through a grid column from 0fr to
        1fr, which is how a box of unknown width is animated in CSS. */}
    {/* At the foot's left, over the tabs, riding the sheet's top as the
        map's buttons do at the right: back from the top right at the
        owner's ask (2026-11-04, "Move the mic back to the left side, above
        the tabs"); tapped, it widens to the right into the pill. In the
        air it grows to 60 points there. */}
    {onPhone && mic}
    </>
  );
}
