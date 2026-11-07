import { Marker } from "maplibre-gl";
import type { IconLike } from "../icons";

export type { IconLike };

/**
 * A MapLibre marker drawn from one of the app's own div icons (icons.ts:
 * traffic, the replay's airplane, own ship's), so a mark looks the same
 * and carries the same data attributes on either map. MapLibre places a
 * marker's element in the frame it draws the chart, so it stays on its
 * point through a pinch, at its own size.
 */
export function iconMarker(icon: IconLike, options: { interactive?: boolean } = {}): Marker {
  const el = document.createElement("div");
  setIcon(el, icon);
  if (!options.interactive) el.style.pointerEvents = "none";
  return new Marker({ element: el, anchor: "top-left" }).setOffset(offsetOf(icon));
}

/** The marker's element made again from `icon`, and its anchor. */
export function setMarkerIcon(marker: Marker, icon: IconLike) {
  setIcon(marker.getElement(), icon);
  marker.setOffset(offsetOf(icon));
}

function setIcon(el: HTMLElement, icon: IconLike) {
  const { html, iconSize, className } = icon.options;
  const [w, h] = sizeOf(iconSize);
  el.className = `${className ?? ""} relative`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.innerHTML = typeof html === "string" ? html : "";
}

function sizeOf(size: unknown): [number, number] {
  if (Array.isArray(size)) return [Number(size[0]) || 0, Number(size[1]) || 0];
  if (size && typeof size === "object" && "x" in size) return [Number((size as { x: number }).x), Number((size as unknown as { y: number }).y)];
  return [0, 0];
}

function offsetOf(icon: IconLike): [number, number] {
  const [w, h] = sizeOf(icon.options.iconSize);
  const anchor = icon.options.iconAnchor;
  const [ax, ay] = anchor ? sizeOf(anchor) : [w / 2, h / 2];
  return [-ax, -ay];
}
