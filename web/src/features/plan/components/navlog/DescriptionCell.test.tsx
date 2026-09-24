// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Description } from "../../hooks/usePlan";
import { DescriptionCell } from "./NavLogView";

afterEach(cleanup);

const generated = (text: string): Description => ({ text, source: "generated" });

function cell(description: Description | undefined, onSave = vi.fn(() => Promise.resolve())) {
  const view = render(<DescriptionCell description={description} onSave={onSave} selected={false} onFocus={() => {}} />);
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  const rerender = (next: Description | undefined) =>
    view.rerender(<DescriptionCell description={next} onSave={onSave} selected={false} onFocus={() => {}} />);
  return { box, onSave, rerender };
}

describe("a checkpoint's note box", () => {
  test("an untouched box shows a line that streams in at once", () => {
    const { box, rerender } = cell(undefined);
    rerender(generated("the water tower"));
    expect(box.value).toBe("the water tower");
  });

  test("a line that streams in while the pilot types does not replace the typing, and the typing is saved", () => {
    // It used to: the box reset to the arriving line, and the blur that
    // followed saw nothing new, so the pilot's note was silently lost.
    const { box, onSave, rerender } = cell(undefined);
    fireEvent.change(box, { target: { value: "red barn by the bend" } });
    rerender(generated("a river bend"));
    expect(box.value).toBe("red barn by the bend");

    fireEvent.blur(box);
    expect(onSave).toHaveBeenCalledWith("red barn by the bend");
  });

  test("a save that fails leaves the typing in the box", async () => {
    let fail!: () => void;
    const onSave = vi.fn(() => new Promise<void>((_, reject) => { fail = () => reject(new Error("502")); }));
    const { box } = cell(generated("a town"), onSave);
    fireEvent.change(box, { target: { value: "the grain elevator" } });
    fireEvent.blur(box);
    await act(async () => { fail(); });
    expect(box.value).toBe("the grain elevator");
  });

  test("once saved, the box goes back to showing the note as it stands", async () => {
    const { box, rerender } = cell(generated("a town"));
    fireEvent.change(box, { target: { value: "the grain elevator" } });
    await act(async () => { fireEvent.blur(box); });
    rerender({ text: "the grain elevator", source: "saved" });
    rerender(generated("regenerated later"));
    expect(box.value).toBe("regenerated later");
  });

  test("emptied and left, it shows the stored note again and saves nothing", () => {
    const { box, onSave } = cell(generated("a town"));
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    expect(onSave).not.toHaveBeenCalled();
    expect(box.value).toBe("a town");
  });
});
