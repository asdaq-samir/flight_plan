// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import InputGuide, { ONE_AT_A_TIME, guideFor } from "./InputGuide";
import { gearFor } from "../lib/audioGear";

afterEach(cleanup);

describe("guideFor", () => {
  it("says the radio for gear its maker documents sending the radio", () => {
    expect(guideFor("GMA 350c")).toEqual({ hears: "radio", line: "Hears the radio", steps: [], how: null });
  });

  it("says a voice for a headset, with its maker's steps and the one-input note once", () => {
    const guide = guideFor("Bose A20")!;
    expect(guide.hears).toBe("voice");
    expect(guide.line).toBe("Hears your voice, not the radio");
    const own = gearFor("Bose A20")!.steps;
    expect(guide.steps.slice(0, own.length)).toEqual(own);
    const said = own.some(step => /last one to connect|takes the input/i.test(step));
    expect(guide.steps.filter(step => step === ONE_AT_A_TIME)).toHaveLength(said ? 0 : 1);
  });

  it("says nothing for the phone's own microphone, an input it can't name, or one that may or may not send the radio", () => {
    expect(guideFor("iPhone Microphone")).toBeNull();
    expect(guideFor("")).toBeNull();
    expect(guideFor(null)).toBeNull();
    expect(guideFor("Kitchen Speaker")).toBeNull();
  });

  it("says maybe for gear only a ground test can tell, never the radio", () => {
    const guide = guideFor("Delta Zulu_1234")!;
    expect(guide.hears).toBe("maybe");
    expect(guide.line).toBe("May hear the radio: test it on the ground");
    expect(guide.how).toBe("How to test it");
    expect(guide.steps.length).toBeGreaterThan(0);
  });
});

describe("InputGuide", () => {
  it("shows the radio as one line", () => {
    render(<InputGuide label="GMA 350c" />);
    expect(screen.getByTestId("input-guide").textContent).toBe("Hears the radio");
    expect(screen.queryByTestId("input-guide-how")).toBeNull();
  });

  it("folds a voice's steps under one tap", () => {
    render(<InputGuide label="AirPods Pro" />);
    expect(screen.getByTestId("input-guide").textContent).toContain("Hears your voice, not the radio");
    expect(screen.queryByTestId("input-guide-steps")).toBeNull();
    fireEvent.click(screen.getByTestId("input-guide-how"));
    expect(screen.getByTestId("input-guide-steps").querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it("draws nothing for the phone's microphone", () => {
    const { container } = render(<InputGuide label="iPhone Microphone" />);
    expect(container.innerHTML).toBe("");
  });
});
