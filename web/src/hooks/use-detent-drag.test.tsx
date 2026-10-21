// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDetentDrag } from "./use-detent-drag";

const detents = { low: 100, half: 300, full: 600 };

function Sheet({ onRelease, setDragged, shown = 300 }: { onRelease: (d: string) => void; setDragged: (h: number | null) => void; shown?: number }) {
  const { body } = useDetentDrag({ detents, shown, fromBottom: true, onRelease, setDragged });
  return <div ref={body} data-testid="body"><p>text</p></div>;
}

const touch = (target: Element, y: number, x = 0) => ({ target, clientX: x, clientY: y, identifier: 0 });
function fire(el: Element, type: string, touches: ReturnType<typeof touch>[], at?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: touches });
  if (at !== undefined) Object.defineProperty(event, "timeStamp", { value: at });
  act(() => { el.dispatchEvent(event); });
}

afterEach(cleanup);

describe("useDetentDrag body drag", () => {
  it("lets the sheet go to a detent when a second finger lands mid-drag", () => {
    const onRelease = vi.fn(), setDragged = vi.fn();
    const { getByTestId } = render(<Sheet onRelease={onRelease} setDragged={setDragged} />);
    const el = getByTestId("body");
    fire(el, "touchstart", [touch(el, 400)]);
    fire(el, "touchmove", [touch(el, 380)]);
    fire(el, "touchmove", [touch(el, 300)]);
    fire(el, "touchstart", [touch(el, 300), touch(el, 200, 50)]);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(setDragged).toHaveBeenLastCalledWith(null);
    fire(el, "touchend", []);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("waits for a first move that has a direction", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Sheet onRelease={onRelease} setDragged={vi.fn()} />);
    const el = getByTestId("body");
    fire(el, "touchstart", [touch(el, 400)]);
    fire(el, "touchmove", [touch(el, 400)]);
    fire(el, "touchmove", [touch(el, 300)]);
    fire(el, "touchend", []);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe("useDetentDrag scroll-first box", () => {
  function Boxed({ onRelease }: { onRelease: (d: string) => void }) {
    const { body } = useDetentDrag({ detents, shown: 300, fromBottom: true, onRelease, setDragged: vi.fn() });
    return <div ref={body}><div data-scroll-first="" data-testid="box"><p data-testid="line">KDLH</p></div></div>;
  }
  const lines = (el: HTMLElement, scrollTop: number, scrollHeight = 96) => {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 64, configurable: true });
    el.scrollTop = scrollTop;
  };

  it("scrolls its three lines first, then drags the sheet up", () => {
    // The owner's ask: the route box scrolls while it can, then the card.
    const onRelease = vi.fn();
    const { getByTestId } = render(<Boxed onRelease={onRelease} />);
    const box = getByTestId("box"), line = getByTestId("line");
    lines(box, 0);
    fire(line, "touchstart", [touch(line, 400)]);
    fire(line, "touchmove", [touch(line, 380)]);
    fire(line, "touchmove", [touch(line, 300)]);
    fire(line, "touchend", []);
    expect(onRelease).not.toHaveBeenCalled();
    // Scrolled to its end: the sheet takes the drag.
    lines(box, 32);
    fire(line, "touchstart", [touch(line, 400)]);
    fire(line, "touchmove", [touch(line, 380)]);
    fire(line, "touchmove", [touch(line, 300)]);
    fire(line, "touchend", []);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("drags the sheet for two lines a hit area's reach past the box's height", () => {
    // The owner's "route box is still scrolling": two lines at a larger
    // text size held 2 px more than the box.
    const onRelease = vi.fn();
    const { getByTestId } = render(<Boxed onRelease={onRelease} />);
    const box = getByTestId("box"), line = getByTestId("line");
    lines(box, 0, 66);
    fire(line, "touchstart", [touch(line, 400)]);
    fire(line, "touchmove", [touch(line, 380)]);
    fire(line, "touchmove", [touch(line, 300)]);
    fire(line, "touchend", []);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe("useDetentDrag release speed", () => {
  // Half (300) dragged down to 210 in quick moves: nearer half than the low
  // detent (100), so it goes on to low only if thrown.
  const dragDown = (el: Element, releaseAt: number) => {
    fire(el, "touchstart", [touch(el, 400)], 0);
    for (let i = 1; i <= 6; i++) fire(el, "touchmove", [touch(el, 400 + 15 * i)], 16 * i);
    fire(el, "touchend", [], releaseAt);
  };

  it("throws the sheet on to the next detent when let go moving", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Sheet onRelease={onRelease} setDragged={vi.fn()} />);
    dragDown(getByTestId("body"), 100);
    expect(onRelease).toHaveBeenLastCalledWith("low");
  });

  it("sets the sheet down where it is when the finger held still before letting go", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Sheet onRelease={onRelease} setDragged={vi.fn()} />);
    dragDown(getByTestId("body"), 96 + 700);
    expect(onRelease).toHaveBeenLastCalledWith("half");
  });

  it("does the same for a drag of the head", () => {
    const onRelease = vi.fn();
    function Head() {
      const { startDrag } = useDetentDrag({ detents, shown: 300, fromBottom: true, onRelease, setDragged: vi.fn() });
      return <div data-testid="head" onPointerDown={startDrag} />;
    }
    const { getByTestId } = render(<Head />);
    const pointer = (type: string, y: number, at: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientY: y });
      Object.defineProperty(event, "timeStamp", { value: at });
      act(() => { (type === "pointerdown" ? getByTestId("head") : window).dispatchEvent(event); });
    };
    for (const [releaseAt, rest] of [[100, "low"], [96 + 700, "half"]] as const) {
      pointer("pointerdown", 400, 0);
      for (let i = 1; i <= 6; i++) pointer("pointermove", 400 + 15 * i, 16 * i);
      pointer("pointerup", 490, releaseAt);
      expect(onRelease).toHaveBeenLastCalledWith(rest);
    }
  });
});

describe("useDetentDrag throw", () => {
  // A finger's throw from where the sheet is, `dy` points down the screen
  // over three quick moves, let go at once.
  const thrown = (el: Element, dy: number) => {
    fire(el, "touchstart", [touch(el, 400)], 0);
    for (let i = 1; i <= 3; i++) fire(el, "touchmove", [touch(el, 400 + (dy * i) / 3)], 8 * i);
    fire(el, "touchend", [], 26);
  };

  it("goes one detent up from the lowest, however hard, not past it to the top", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Sheet shown={100} onRelease={onRelease} setDragged={vi.fn()} />);
    thrown(getByTestId("body"), -180);
    expect(onRelease).toHaveBeenLastCalledWith("half");
  });

  it("goes one detent down from the top, however hard, not past it to the lowest", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Sheet shown={600} onRelease={onRelease} setDragged={vi.fn()} />);
    thrown(getByTestId("body"), 240);
    expect(onRelease).toHaveBeenLastCalledWith("half");
  });

  it("goes on up from past half when the finger itself took it there", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Sheet shown={100} onRelease={onRelease} setDragged={vi.fn()} />);
    thrown(getByTestId("body"), -260);
    expect(onRelease).toHaveBeenLastCalledWith("full");
  });
});
