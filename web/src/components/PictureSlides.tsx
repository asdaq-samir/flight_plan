import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "./ui/carousel";

/**
 * A card's picture box that swipes, a page at a time, between what it
 * shows: the airport card's diagram, its aerial and its photo from the
 * ground (PlaceCard), and the airplane card's sketch and its photo
 * (AirplaneSketch) -- one look and one code for both, at the owner's asks
 * ("Stock carousel", "They should have common code as their look is very
 * similar"), on shadcn's Carousel (Embla). The dots over its foot say which
 * page is in sight, as iOS's page control does; with one page, none.
 */
export function PictureSlides({ slides, className, testId, label, flush = false }: {
  slides: ReactNode[];
  className?: string;
  testId?: string;
  /** What the pictures are of, for VoiceOver. */
  label: string;
  /** Across a card's top (PhotoHead): square, the sheet's corners its
   *  own, and the dots in its bottom right corner, clear of the name set
   *  over its foot. */
  flush?: boolean;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!api) return;
    const select = () => setPage(api.selectedScrollSnap());
    api.on("select", select);
    api.on("reInit", select);
    return () => { api.off("select", select); api.off("reInit", select); };
  }, [api]);
  const shown = slides.filter(Boolean);
  return (
    <Carousel setApi={setApi} aria-label={label} className={cn("relative min-h-0 overflow-hidden", !flush && "rounded-xl", className)} data-testid={testId}>
      {/* The stock content and items, the page's own height, no gutter
          between pages: a picture box, not a row of cards. */}
      <CarouselContent className="ml-0 h-full" wrapperClassName="h-full">
        {shown.map((slide, i) => (
          <CarouselItem key={i} className="relative h-full pl-0">{slide}</CarouselItem>
        ))}
      </CarouselContent>
      {shown.length > 1 && (
        <div aria-hidden="true" className={cn("pointer-events-none absolute flex gap-1", flush ? "right-4 bottom-[1.125rem]" : "inset-x-0 bottom-1 justify-center")} data-testid={testId && `${testId}-dots`}>
          {shown.map((_, i) => (
            <span key={i} className={cn("size-1.5 rounded-full shadow-[0_0_2px_rgba(0,0,0,.6)]", i === page ? "bg-white" : "bg-white/45")} />
          ))}
        </div>
      )}
    </Carousel>
  );
}

/**
 * A photo filling a page of the box, its credit over its corner as its
 * licence asks: a tap opens it full screen (`onOpen`), or its source's page
 * (`href`), as each card's does.
 */
export function PhotoSlide({ src, alt, credit, href, onOpen, label, testId, creditTestId, flush = false }: {
  src: string;
  alt: string;
  /** Where its licence asks for one; none for the USGS's public domain. */
  credit?: string;
  href?: string;
  onOpen?: () => void;
  /** The tap's name, for VoiceOver. */
  label: string;
  testId?: string;
  creditTestId?: string;
  /** Across a card's top (PictureSlides' `flush`): square, its credit in
   *  the top left, out of the way of the name over its foot and of the
   *  share and close in the top right. */
  flush?: boolean;
}) {
  const picture = <img src={src} alt={alt} loading="lazy" className={cn("size-full object-cover", !flush && "rounded-xl")} />;
  const tap = cn("absolute inset-0 block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", !flush && "rounded-xl");
  return (
    <>
      {href ? (
        <a href={href} target="_blank" rel="noopener" aria-label={label} className={tap} data-testid={testId}>{picture}</a>
      ) : (
        <button type="button" onClick={onOpen} aria-label={label} className={tap} data-testid={testId}>{picture}</button>
      )}
      {credit && <span
        className={cn("pointer-events-none absolute max-w-[90%] truncate rounded bg-black/55 px-1 text-white", flush ? "top-3 left-3 max-w-[55%]" : "right-1 bottom-3.5", TEXT.caption)}
        data-testid={creditTestId}
      >
        {credit}
      </span>}
    </>
  );
}
