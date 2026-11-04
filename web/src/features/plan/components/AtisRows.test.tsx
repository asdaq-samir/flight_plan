// @vitest-environment jsdom
/**
 * Listen to ATIS through the input the radio is heard through: the row
 * names an outside input where one is held (lib/audioInput, here set in
 * the radio's store as it would), says nothing was heard through it, and
 * will not start a second recognizer while the radio is listened to. The
 * browser's recognizer is a stand-in that hears nothing.
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

const PANEL = { label: "GMA 350c", outside: true, lost: false, instead: null };

beforeEach(() => {
  vi.stubGlobal("SpeechRecognition", Quiet);
  useAtcRadio.setState({ listening: false, mode: null, input: null });
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
      .toBe("Nothing was heard through GMA 350c. Tune the ATIS, check its Bluetooth recording mode is on and tap again."));
  });

  test("will not listen while the radio is listened to, and says where to stop it", async () => {
    useAtcRadio.setState({ listening: true, mode: "radio" });
    render(<AtisRows />);
    fireEvent.click(screen.getByTestId("place-atis-listen"));
    await waitFor(() => expect(screen.getByTestId("place-atis-problem").textContent)
      .toBe("The radio is being listened to; stop it in the Radio card first."));
  });
});
