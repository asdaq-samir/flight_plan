import { queryOptions } from "@tanstack/react-query";

/** A photo of an airplane from Planespotters.net, as its card shows it. */
export interface PlanePhoto {
  /** Its 420 by 280 thumbnail, on Planespotters' own server. */
  src: string;
  width: number;
  height: number;
  /** The photo's page on Planespotters, which the thumbnail links to. */
  link: string;
  photographer: string;
}

interface Answer {
  photos?: {
    thumbnail_large?: { src?: string; size?: { width?: number; height?: number } };
    link?: string;
    photographer?: string;
  }[];
}

/**
 * The airplane's photo on its card, at the owner's ask ("I also like the
 * idea of having the actual airframe photo"), from Planespotters.net's
 * public API by its ICAO address: one photo, free, no key. Asked by the
 * browser itself, as Planespotters asks of an app's pages (a server must
 * name a contact in its user agent instead), and shown as its terms ask:
 * its thumbnail hotlinked from their server and linked to the photo's own
 * page, the photographer named beside it, and never behind a paid
 * feature. None where Planespotters has no photo of it or does not
 * answer: the card's sketch is then its only picture.
 */
export const planePhotoQuery = (hex: string) => queryOptions({
  queryKey: ["plane-photo", hex],
  queryFn: async ({ signal }): Promise<PlanePhoto | null> => {
    const response = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`, { signal });
    if (!response.ok) return null;
    const photo = ((await response.json()) as Answer).photos?.[0];
    const large = photo?.thumbnail_large;
    if (!large?.src || !photo?.link || !photo.photographer) return null;
    return {
      src: large.src, width: large.size?.width ?? 420, height: large.size?.height ?? 280,
      link: photo.link, photographer: photo.photographer,
    };
  },
  // A photo changes seldom: asked once a day an airplane at most, and
  // never again on a failure, which shows the sketch alone.
  staleTime: 24 * 3600_000,
  gcTime: 24 * 3600_000,
  retry: false,
  meta: { silent: true },
});
