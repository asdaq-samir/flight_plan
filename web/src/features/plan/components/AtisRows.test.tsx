// @vitest-environment jsdom
/**
 * Listen to ATIS through the input the radio is heard through: the row
 * names an outside input where one is held (lib/audioInput, here set in
 * the radio's store as it would), says nothing was heard through it, will
 * not start a second recognizer while the radio is listened to, and gives
 * way when it starts. The browser's recognizer is a stand-in that hears
 * nothing.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAtcRadio } from "../../../lib/atcRadio";
import { AtisRows } from "./AtisRows";

class Quiet {
  lang = ""; continuous = false; interimResults = false;
  onresult = null; onerror = null;
  onend: (() => void) | null = null;
  start() {}
  stop() { setTimeout(() => this.onend?.(), 0); }
}

const PANEL = { label: "GMA 350c", outside: true, lost: false, why: null, instead: null, paused: false };

beforeEach(() => {
  vi.stubGlobal("SpeechRecognition", Quiet);
  useAtcRadio.setState({ listening: false, mode: null, input: null, atisStop: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Listen to ATIS", () => {
  test("names the outside input it listens through, and says nothing was heard through it", async () => {
    render(<AtisRows />);
    const row = screen.getByTestId("place-atis-listen");
    fireEvent.click(row);
    expect(row.textContent).toContain("Tune the ATIS or AWOS and hold the phone to the speaker");
    act(() => useAtcRadio.setState({ input: PANEL }));
    expect(row.textContent).toContain("Tune the ATIS or AWOS; listening through GMA 350c");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("place-atis-problem").textContent)
      .toBe("Nothing was heard through GMA 350c. Tune the ATIS, check it is sending the radio (an audio panel's recording mode, or the cable) and tap again."));
  });

  test("in Safari, whose recognizer is not known to hear the input, it is named as chosen, the speaker still the sure way", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", Quiet);
    render(<AtisRows />);
    const row = screen.getByTestId("place-atis-listen");
    fireEvent.click(row);
    act(() => useAtcRadio.setState({ input: PANEL }));
    expect(row.textContent).toContain("Tune the ATIS or AWOS; GMA 350c chosen, or hold the phone to the speaker");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("place-atis-problem").textContent)
      .toBe("Nothing was heard. Tune the ATIS, hold the phone to the speaker and tap again."));
  });

  test("will not listen while the radio or the microphone listens, and says where to stop it, as a notice", async () => {
    useAtcRadio.setState({ listening: true, mode: "radio" });
    render(<AtisRows />);
    fireEvent.click(screen.getByTestId("place-atis-listen"));
    const problem = await screen.findByTestId("place-atis-problem");
    expect(problem.textContent).toBe("Already listening to the radio; stop it in the Radio card first.");
    expect(problem.className).toContain("text-caution-ink");
    act(() => useAtcRadio.setState({ mode: "once" }));
    fireEvent.click(screen.getByTestId("place-atis-listen"));
    await waitFor(() => expect(screen.getByTestId("place-atis-problem").textContent).toBe("Already listening; tap the microphone to stop it first."));
  });

  test("gives way to the radio or the microphone started meanwhile, and says so", async () => {
    render(<AtisRows />);
    fireEvent.click(screen.getByTestId("place-atis-listen"));
    const giveWay = useAtcRadio.getState().atisStop;
    expect(giveWay).toBeTypeOf("function");
    act(() => giveWay!());
    await waitFor(() => expect(screen.getByTestId("place-atis-problem").textContent).toBe("Stopped for the microphone; tap to listen again."));
    expect(useAtcRadio.getState().atisStop).toBeNull();
  });
});
