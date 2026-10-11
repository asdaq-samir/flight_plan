// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeTopmost } from "./back";
import { holdOpenCard } from "./openCards";

/** Android's back as Escape: the topmost thing open closed, else the
 *  panel lowered, else nothing (and the app put away). */
describe("closeTopmost", () => {
  const listeners: (() => void)[] = [];
  const on = (target: EventTarget, handler: (event: KeyboardEvent) => void) => {
    const listener = (event: Event) => handler(event as KeyboardEvent);
    target.addEventListener("keydown", listener);
    listeners.push(() => target.removeEventListener("keydown", listener));
  };
  afterEach(() => {
    listeners.splice(0).forEach(off => off());
    document.body.innerHTML = "";
  });

  it("closes what takes Escape, a card or a menu, and goes no further", () => {
    document.body.innerHTML = '<div data-slot="map-panel" data-panel="half"></div>';
    let lowered = false;
    on(document.querySelector("[data-slot=map-panel]")!, () => { lowered = true; });
    on(document, event => { if (event.key === "Escape") event.preventDefault(); });
    expect(closeTopmost()).toBe(true);
    expect(lowered).toBe(false);
  });

  it("closes the card on top, an airport's over Nearest's, before the panel", () => {
    document.body.innerHTML = '<div data-slot="map-panel" data-panel="half"></div>';
    const closed: string[] = [];
    let lowered = false;
    on(document.querySelector("[data-slot=map-panel]")!, () => { lowered = true; });
    const nearest = holdOpenCard({ close: () => closed.push("nearest") });
    const airport = holdOpenCard({ close: () => closed.push("airport") });
    expect(closeTopmost()).toBe(true);
    airport();
    expect(closeTopmost()).toBe(true);
    nearest();
    expect(closed).toEqual(["airport", "nearest"]);
    expect(lowered).toBe(false);
  });

  it("lowers the panel when nothing else is open", () => {
    document.body.innerHTML = '<div data-slot="map-panel" data-panel="full"></div>';
    let lowered = 0;
    on(document.querySelector("[data-slot=map-panel]")!, event => { if (event.key === "Escape") lowered += 1; });
    expect(closeTopmost()).toBe(true);
    expect(lowered).toBe(1);
  });

  it("has nothing to close with the panel down", () => {
    document.body.innerHTML = '<div data-slot="map-panel" data-panel="peek"></div>';
    expect(closeTopmost()).toBe(false);
  });
});
