// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDetentDrag } from "./use-detent-drag";

const detents = { low: 100, half: 300, full: 600 };

function Sheet({ onRelease, setDragged }: { onRelease: (d: string) => void; setDragged: (h: number | null) => void }) {
  const { body } = useDetentDrag({ detents, shown: 300, fromBottom: true, onRelease, setDragged });
  return <div ref={body} data-testid="body"><p>text</p></div>;
}

const touch = (target: Element, y: number, x = 0) => ({ target, clientX: x, clientY: y, identifier: 0 });
function fire(el: Element, type: string, touches: ReturnType<typeof touch>[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: touches });
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
