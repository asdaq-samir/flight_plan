import { create } from "zustand";
import { AIRPORT_MARK } from "./airportMark";

/**
 * Keeping the VORs' idents off the airports' marks and own ship (the
 * owner's screenshot over Chicago, 2026-10-29: DPA's tag under KDPA's
 * mark, own ship over OBK's hexagon and tag). Everything here is in the map's own pixels at
 * one zoom (map.project), where only the gaps between things matter.
 */

/** A box on the screen, px: left, top, right and bottom. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Point { x: number; y: number }

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The width of 11 px bold capitals, a letter, guessed a little wide: a
 *  word that overlaps by a pixel is worth moving. */
const LETTER_PX = 7;

/** An airport as drawn (AirportCanvas): its 26 px mark centred on the
 *  field and its ident one point clear to the right, as one box. */
export function airportBox(at: Point, ident: string): Box {
  const half = AIRPORT_MARK / 2;
  return { x0: at.x - half, y0: at.y - half, x1: at.x + half + 1 + ident.length * LETTER_PX + 2, y1: at.y + half };
}

/** Own ship's airplane as drawn (icons' ownShipIcon): 34 px at most,
 *  centred on the fix; its beam is mostly clear and not counted. */
export function ownShipBox(at: Point): Box {
  return { x0: at.x - 17, y0: at.y - 17, x1: at.x + 17, y1: at.y + 17 };
}

/** A VOR's tag as vorIcon draws it: 11 px off the station, 14 tall,
 *  its ident with 4 px either side. */
const VOR_TAG_GAP = 11;
const VOR_TAG_HEIGHT = 14;

export type TagSide = "right" | "left" | "none";

/** Which side of its hexagon a VOR's ident tag goes: the right, as the
 *  chart's, unless that is on an airport's mark or own ship and the left
 *  is clear; neither where both are blocked. */
export function vorTagSide(at: Point, ident: string, blockers: Box[]): TagSide {
  const width = ident.length * LETTER_PX + 8;
  const y0 = at.y - VOR_TAG_HEIGHT / 2, y1 = at.y + VOR_TAG_HEIGHT / 2;
  const right = { x0: at.x + VOR_TAG_GAP, y0, x1: at.x + VOR_TAG_GAP + width, y1 };
  const left = { x0: at.x - VOR_TAG_GAP - width, y0, x1: at.x - VOR_TAG_GAP, y1 };
  if (!blockers.some(b => overlaps(b, right))) return "right";
  if (!blockers.some(b => overlaps(b, left))) return "left";
  return "none";
}

export interface DrawnField { ident: string; lat: number; lon: number }
const NO_FIELDS: DrawnField[] = [];

/** The fields drawn with their marks and idents just now (AirportsLayer's
 *  and the route's), for what else is drawn on the map -- the VORs' tags
 *  -- to keep off. A new list only when what is drawn changes. */
export const useDrawnAirports = create<{ fields: DrawnField[] }>(() => ({ fields: NO_FIELDS }));
