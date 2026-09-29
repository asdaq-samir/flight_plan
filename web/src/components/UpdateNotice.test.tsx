// @vitest-environment jsdom
/**
 * A new build is offered as a toast, folded to a pill when the toast is
 * put away, and unfolded again from the pill -- never dropped until
 * Reload takes it. sonner's own toast is stubbed: what matters here is
 * when it is asked for and what its buttons do.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAppUpdate } from "../lib/appUpdate";
import UpdateNotice from "./UpdateNotice";

const shown = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: shown }));

type Options = { action: { onClick: () => void }; cancel: { onClick: () => void }; onDismiss: () => void };
const lastOptions = () => shown.mock.calls.at(-1)![1] as Options;

describe("UpdateNotice", () => {
  beforeEach(() => {
    shown.mockClear();
    useAppUpdate.setState({ reload: null, minimized: false, reloading: false });
  });
  afterEach(cleanup);

  test("nothing until a build is waiting", () => {
    render(<UpdateNotice />);
    expect(shown).not.toHaveBeenCalled();
    expect(screen.queryByTestId("app-update-pill")).toBeNull();
  });

  test("a waiting build is a toast; put away, it is the pill; the pill brings the toast back", () => {
    const reload = vi.fn(() => Promise.resolve());
    render(<UpdateNotice />);
    act(() => useAppUpdate.getState().ready(reload));
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown.mock.calls[0]?.[0]).toBe("A new version of the planner is ready");
    expect(screen.queryByTestId("app-update-pill")).toBeNull();

    act(() => lastOptions().onDismiss());
    expect(screen.getByTestId("app-update-pill")).toBeTruthy();

    fireEvent.click(screen.getByTestId("app-update-pill"));
    expect(shown).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("app-update-pill")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  test("Reload takes the build, and the toast's own dismissal then does not fold it to the pill", () => {
    const reload = vi.fn(() => Promise.resolve());
    render(<UpdateNotice />);
    act(() => useAppUpdate.getState().ready(reload));
    act(() => lastOptions().action.onClick());
    expect(reload).toHaveBeenCalledWith(true);
    act(() => lastOptions().onDismiss());
    expect(screen.queryByTestId("app-update-pill")).toBeNull();
  });
});
