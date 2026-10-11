// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrow, isBack, leave, tvPlatform } from "./tv";

const key = (init: KeyboardEventInit & { keyCode?: number }) => {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
  if (init.keyCode) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  return event;
};

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("isBack", () => {
  it("knows Samsung's Return and LG's Back", () => {
    expect(isBack(key({ keyCode: 10009 }))).toBe(true);
    expect(isBack(key({ keyCode: 461 }))).toBe(true);
    expect(isBack(key({ key: "GoBack" }))).toBe(true);
    expect(isBack(key({ key: "Escape" }))).toBe(false);
  });
});

describe("tvPlatform", () => {
  it("keeps the platform asked for in the address", () => {
    window.history.replaceState(null, "", "/?tv=webos");
    expect(tvPlatform()).toBe("webos");
    window.history.replaceState(null, "", "/");
    expect(tvPlatform()).toBe("webos");
  });
  it("ignores an unknown platform", () => {
    window.history.replaceState(null, "", "/?tv=roku");
    expect(tvPlatform()).toBeNull();
  });
  it("knows a TV's browser by its agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit" });
    expect(tvPlatform()).toBe("tizen");
  });
});

describe("arrow", () => {
  it("moves the focus with navigate()", () => {
    const navigate = vi.fn();
    vi.stubGlobal("navigate", navigate);
    const event = key({ key: "ArrowDown" });
    arrow(event);
    expect(navigate).toHaveBeenCalledWith("down");
    expect(event.defaultPrevented).toBe(true);
  });
  it("leaves an input's caret alone except at its ends", () => {
    const navigate = vi.fn();
    vi.stubGlobal("navigate", navigate);
    document.body.innerHTML = '<input id="f" value="KJFK">';
    const input = document.getElementById("f") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 2);
    arrow(key({ key: "ArrowRight" }));
    expect(navigate).not.toHaveBeenCalled();
    input.setSelectionRange(4, 4);
    arrow(key({ key: "ArrowRight" }));
    expect(navigate).toHaveBeenCalledWith("right");
  });
  it("leaves an arrow a control took first", () => {
    const navigate = vi.fn();
    vi.stubGlobal("navigate", navigate);
    const event = key({ key: "ArrowUp" });
    event.preventDefault();
    arrow(event);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("leave", () => {
  it("exits a Tizen app through its own API", () => {
    const exit = vi.fn();
    vi.stubGlobal("tizen", { application: { getCurrentApplication: () => ({ exit }) } });
    leave("tizen");
    expect(exit).toHaveBeenCalled();
  });
  it("closes the window otherwise", () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    leave("webos");
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });
});
