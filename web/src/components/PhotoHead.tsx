import { useEffect, useRef, useState, type ReactNode } from "react";
import { Share } from "lucide-react";
import { cn } from "cn";
import CloseButton from "./CloseButton";
import RoundButton from "./RoundButton";
import { PictureSlides } from "./PictureSlides";
import { closeTopCard, useHeldCard, type PillHead } from "../lib/openCards";
import { TEXT } from "../lib/text";

/** The picture's height, in points: Maps' place photos' room, and fixed
 *  whatever the text size, the name over its foot growing into it. */
const HEAD_PX = 210;

/** How tall the bar is that takes the name's place once the picture has
 *  scrolled up out of sight: the round buttons' 36 and room round them. */
const BAR_PX = 56;

/** The share and the close over a picture: a dark pane of glass with the
 *  glyph white, which reads on a photo whatever the theme, where the
 *  sheet's own grey glass was lost on a dark one. */
const OVER_PICTURE = "bg-black/45 text-white backdrop-blur-md hover:bg-black/55 hover:text-white dark:bg-black/45 dark:hover:bg-black/55";

/**
 * A card's head as a picture across its top, as Apple's Maps opens a
 * place over its photos, at the owner's pick of the airport and airplane
 * cards' redesign (A2, 2026-10-29): the pictures a swipe across with their
 * dots, the name large over a dark shade at their foot with what it is
 * under it, the sheet's grabber over their top (MapPanel), and the
 * card's share and close on them at the top right -- the minimized bar's,
 * which the panel leaves out over a card with this head out of the pill
 * (`picture` in lib/openCards). The close goes back one card, as the
 * bar's did. Scrolled up past the picture, a bar takes its place with the
 * name, the share and the close on it, so the way back is always in sight.
 */
export function PhotoHead({ title, subtitle, line, slides, label, onClose, onShare, shareAtLeft, beside, pill, testId, titleTestId, subtitleTestId, closeTestId, shareTestId, children }: {
  /** Set large over the picture's foot: an airport's ident, an airplane's callsign. */
  title: string;
  /** Under it: "Duluth International · Duluth, MN". */
  subtitle?: ReactNode;
  /** A line under that, smaller. */
  line?: ReactNode;
  /** The pictures, a page each (PictureSlides, flush). */
  slides: ReactNode[];
  /** What the pictures are of, for VoiceOver. */
  label: string;
  onClose: () => void;
  onShare?: () => void;
  /** The share alone at the top left, the close and `beside` at the right:
   *  the airport card's, at the owner's ask (2026-10-29). */
  shareAtLeft?: boolean;
  /** A round button before the close, given the look the close has over
   *  the picture or on the bar (the airport card's star). */
  beside?: (look: string) => ReactNode;
  /** What the pill shows of the card down at its smallest: a line under
   *  the name and the first picture's address (lib/openCards). */
  pill?: PillHead;
  testId: string;
  titleTestId: string;
  subtitleTestId?: string;
  closeTestId: string;
  shareTestId?: string;
  /** Out of its flow: a full-screen viewer. */
  children?: ReactNode;
}) {
  useHeldCard(onClose, onShare, true, pill);
  // Whether the picture has scrolled up under the bar's height, read from
  // the card's scroller as it scrolls.
  const head = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const scroller = head.current?.closest<HTMLElement>(".under-head");
    if (!scroller) return;
    const read = () => setPast(scroller.scrollTop > HEAD_PX - BAR_PX);
    read();
    scroller.addEventListener("scroll", read, { passive: true });
    return () => scroller.removeEventListener("scroll", read);
  }, []);
  const shown = slides.filter(Boolean);
  return (
    <>
      {/* Pinned to the top of the card's scroller, no height of its own:
          the share and the close over the picture, and once it has gone
          up, a bar of the sheet's own colour behind them with the name. */}
      <div className="sticky top-0 z-20 -mx-4 h-0">
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 top-0 flex items-center justify-center border-b border-border/60 bg-(--sheet) px-28 transition-[opacity,visibility] duration-150",
            past ? "visible opacity-100" : "pointer-events-none invisible opacity-0",
          )}
          style={{ height: BAR_PX }}
          data-testid={`${testId}-bar`}
        >
          <span className={cn("truncate font-semibold text-foreground", TEXT.row)}>{title}</span>
        </div>
        {/* Ten apart, as the design has them: their 44-point hit areas
            (index.css) a point over each other's, never grown. */}
        {onShare && shareAtLeft && (
          <div className="absolute top-2.5 left-4 flex">
            <RoundButton label={`Share ${title}`} onClick={onShare} className={cn(!past && OVER_PICTURE)} data-testid={shareTestId}>
              <Share className="size-5" strokeWidth={2} />
            </RoundButton>
          </div>
        )}
        <div className="absolute top-2.5 right-4 flex gap-2.5">
          {onShare && !shareAtLeft && (
            <RoundButton label={`Share ${title}`} onClick={onShare} className={cn(!past && OVER_PICTURE)} data-testid={shareTestId}>
              <Share className="size-5" strokeWidth={2} />
            </RoundButton>
          )}
          {beside?.(cn(!past && OVER_PICTURE))}
          {/* Back one: a page opened in the card first, else the card
              (lib/openCards), as the bar's close goes. */}
          <CloseButton onClick={() => { if (!closeTopCard()) onClose(); }} className={cn(!past && OVER_PICTURE)} data-testid={closeTestId} />
        </div>
      </div>
      <div ref={head} className="relative -mx-4 shrink-0 overflow-hidden bg-muted" style={{ height: HEAD_PX }} data-testid={testId} data-picture-head="">
        <PictureSlides flush label={label} slides={shown} className="size-full" testId={`${testId}-pictures`} />
        {/* The name on a shade up from the pictures' foot, whatever the
            picture: as tall as the name's lines and more, so it grows with
            them at a larger text size. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col bg-linear-to-t from-black/85 via-black/55 to-transparent pt-14 pb-3.5 pl-4 text-white [text-shadow:0_1px_2px_rgba(0,0,0,.45)]",
            shown.length > 1 ? "pr-16" : "pr-4",
          )}
        >
          <h2 tabIndex={-1} className={cn("truncate font-extrabold tracking-tight outline-none", TEXT.hero)} data-testid={titleTestId}>{title}</h2>
          {subtitle != null && <p className={cn("line-clamp-2 text-white/90", TEXT.prose)} data-testid={subtitleTestId}>{subtitle}</p>}
          {line}
        </div>
        {children}
      </div>
    </>
  );
}
