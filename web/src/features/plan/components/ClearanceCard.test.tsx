// @vitest-environment jsdom
/**
 * The clearance card's four rows from fixed inputs: the Duluth clearance
 * of fixtures/readbacks.json heard, its places as the planner finds them
 * (fixtures/clearances.json), a read back from the same fixture, and a
 * route filed that the clearance changes. The engine's wasm is loaded
 * for every test file (lib/engine/vitestSetup.ts).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "../../../components/ui/tooltip";
import clearances from "../../../lib/fixtures/clearances.json";
import readbacks from "../../../lib/fixtures/readbacks.json";

vi.mock("../../../lib/api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../lib/api/client")>()),
  api: { clearancePlaces: vi.fn(), clearanceWords: vi.fn() },
}));
vi.mock("../../../lib/atcListening", () => ({ listenOnce: vi.fn(), startRadio: vi.fn(), stopRadio: vi.fn() }));
// The input picker's module (lib/audioInput) as a stand-in: Find Inputs
// lists an iPhone's microphone and a GMA 350c's Bluetooth link.
vi.mock("../../../lib/audioInput", async () => {
  const { create } = await import("zustand");
  type Input = { id: string; label: string; outside: boolean };
  const useInputs = create<{ found: boolean; inputs: Input[]; chosen: string | null; problem: string | null }>(() => ({ found: false, inputs: [], chosen: null, problem: null }));
  return {
    useInputs,
    canPickInput: () => true,
    hold: vi.fn(() => () => {}),
    refresh: vi.fn(async () => {}),
    find: vi.fn(async () => useInputs.setState({
      found: true,
      inputs: [{ id: "iphone", label: "iPhone Microphone", outside: false }, { id: "gma", label: "GMA 350c", outside: true }],
    })),
    pick: vi.fn(async () => {}),
    matchInput: (inputs: Input[], want: { id: string; label: string } | null) => (want ? inputs.find(i => i.id === want.id) ?? null : null),
  };
});

const { api } = await import("../../../lib/api/client");
const { listenOnce } = await import("../../../lib/atcListening");
const audioInput = await import("../../../lib/audioInput");
const { useAtcRadio, useRadioActions } = await import("../../../lib/atcRadio");
const { default: ClearanceCard } = await import("./ClearanceCard");

/** The clearance the read backs are checked against, and its places as
 *  the planner finds them: the fixture leaves out `sure` where a place
 *  was found by its name, which the planner sends as true. */
const CLEARED = readbacks.cleared;
const ROUTE_FOUND = clearances.routes[0]!.found;
const FOUND = { limit: { ...ROUTE_FOUND.limit, sure: true }, route: (ROUTE_FOUND.route ?? []).map(run => run.map(p => ({ ...p, sure: true }))) };
/** A route filed through Brainerd: the clearance puts Gopher before it. */
const PLANNED = { dep: "KMSP", stops: ["BRD"], dest: "KDLH" };
const PARTLY = readbacks.cases.find(c => c.name.startsWith("an altitude said differently"))!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.clearancePlaces).mockResolvedValue(FOUND as never);
  useAtcRadio.setState({ listening: false, error: null, heard: [], seen: null, cardOpen: false, cardText: null, tail: null, near: "", mode: null, pill: null, input: null });
  audioInput.useInputs.setState({ found: false, inputs: [], chosen: null, problem: null });
  useRadioActions.setState({ route: PLANNED, enter: vi.fn() });
});

function card(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TooltipProvider><ClearanceCard onDone={onDone} /></TooltipProvider></QueryClientProvider>);
  const state = (id: string) => screen.getByTestId(`clearance-state-${id}`).textContent;
  return { onDone, state };
}

describe("the clearance card", () => {
  test("with nothing heard, Hear is open to type in and the other rows wait", () => {
    const { state } = card();
    expect(["hear", "readback", "enter", "compare"].map(state)).toEqual(["Not yet", "Not yet", "Not yet", "Not yet"]);
    expect(screen.getByTestId("clearance-text")).toBeTruthy();
    // A folded row's detail is in the page hidden, its contents not drawn.
    expect(screen.getByTestId("clearance-detail-readback").hidden).toBe(true);
    expect(screen.queryByTestId("clearance-readback-text")).toBeNull();
    expect((screen.getByTestId("clearance-enter") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("clearance-error")).toBeNull();
  });

  test("a clearance heard: its items under Hear, the route it gives under Enter, the difference under Compare, and one tap enters it", async () => {
    useAtcRadio.setState({ cardText: CLEARED });
    const { onDone, state } = card();
    expect(state("hear")).toBe("Heard");
    await waitFor(() => expect(state("enter")).toBe("KDLH via GEP BRD, fly 7,000 ft"));
    expect(state("compare")).toBe("1 difference");
    expect(state("readback")).toBe("Not yet");

    // The clearance given, Hear is folded: a tap shows it as CRAFT.
    expect(screen.queryByTestId("clearance-text")).toBeNull();
    fireEvent.click(screen.getByTestId("clearance-row-hear"));
    const hear = within(screen.getByTestId("clearance-detail-hear"));
    expect(hear.getByText("KDLH")).toBeTruthy();
    expect(hear.getByText("GEP", { exact: true })).toBeTruthy();
    expect(hear.getByText("Maintain 5,000 ft, expect 7,000 ft 10 min after departure")).toBeTruthy();
    expect(hear.getByText("Departure 125.35")).toBeTruthy();
    expect(hear.getByText("4512")).toBeTruthy();
    expect((hear.getByTestId("clearance-text") as HTMLTextAreaElement).value).toBe(CLEARED);

    fireEvent.click(screen.getByTestId("clearance-row-compare"));
    const compare = screen.getByTestId("clearance-detail-compare");
    expect(compare.textContent).toContain("KMSP → BRD → KDLH");
    expect(compare.textContent).toContain("Differs from what you filed: adds GEP.");

    fireEvent.click(screen.getByTestId("clearance-row-enter"));
    const enterDetail = screen.getByTestId("clearance-detail-enter");
    expect(enterDetail.textContent).toContain("KMSP → GEP → BRD → KDLH");
    expect(enterDetail.textContent).toContain("Fly 7,000 ft, expected");

    // Nothing in the plan until Enter Route; then the expected altitude flown.
    const enter = useRadioActions.getState().enter!;
    expect(enter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("clearance-enter"));
    expect(enter).toHaveBeenCalledWith({ dep: "KMSP", stops: ["GEP", "BRD"], dest: "KDLH" }, [], 7000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(state("enter")).toBe("Route entered");
    expect((screen.getByTestId("clearance-enter") as HTMLButtonElement).disabled).toBe(true);
  });

  test("the read back typed is checked line by line, its count on the row", async () => {
    useAtcRadio.setState({ cardText: CLEARED });
    const { state } = card();
    await waitFor(() => expect(state("compare")).toBe("1 difference"));
    fireEvent.click(screen.getByTestId("clearance-row-readback"));
    const said = screen.getByTestId("clearance-readback-text");
    fireEvent.change(said, { target: { value: PARTLY.said } });
    expect(state("readback")).toBe("4 of 6 read back");
    const lines = within(screen.getByTestId("clearance-readback-lines"));
    expect(lines.getByText("Limit, route, expected altitude and frequency read back")).toBeTruthy();
    expect(lines.getByText("Altitude: 4,000 ft said, 5,000 ft cleared")).toBeTruthy();
    expect(lines.getByText("Squawk 4512 not read back")).toBeTruthy();
    expect(lines.getAllByLabelText("Differs")).toHaveLength(2);

    fireEvent.change(said, { target: { value: readbacks.cases[0]!.said } });
    expect(state("readback")).toBe("Read back in full");
    expect(screen.getByTestId("clearance-readback-lines").textContent).toBe("Limit, route, altitude, expected altitude, frequency and squawk read back");
  });

  test("Read back again listens once and takes the words as the microphone ends; nothing heard is the card's error line", async () => {
    // A browser that can listen: the microphones are shown.
    vi.stubGlobal("SpeechRecognition", class {});
    useAtcRadio.setState({ cardText: CLEARED });
    const { state } = card();
    await waitFor(() => expect(state("compare")).toBe("1 difference"));
    expect(screen.getByTestId("clearance-toggle").getAttribute("aria-label")).toBe("Listen");
    fireEvent.click(screen.getByTestId("clearance-readback-mic"));
    expect(listenOnce).toHaveBeenCalledWith([], CLEARED);
    expect(state("readback")).toBe("Listening…");
    act(() => useAtcRadio.setState({ listening: true, mode: "once", pill: { listening: true, text: "", error: null, readbackOf: CLEARED } }));
    expect(state("readback")).toBe("Listening…");
    act(() => useAtcRadio.setState({ listening: false, mode: null, pill: { listening: false, text: PARTLY.said, error: null, readbackOf: CLEARED } }));
    expect(state("readback")).toBe("4 of 6 read back");
    // The pill's own line is not wanted as well: the card has the check.
    expect(useAtcRadio.getState().pill).toBeNull();

    fireEvent.click(screen.getByTestId("clearance-readback-mic"));
    expect(state("readback")).toBe("Listening…");
    const quiet = "Nothing was heard. Tap the microphone and speak, or hold the phone to the speaker.";
    act(() => useAtcRadio.setState({ listening: true, mode: "once", pill: { listening: true, text: "", error: null, readbackOf: CLEARED } }));
    act(() => useAtcRadio.setState({ listening: false, mode: null, pill: { listening: false, text: "", error: quiet, readbackOf: CLEARED } }));
    expect(state("readback")).toBe("Not yet");
    expect(screen.getByTestId("clearance-error").textContent).toBe(quiet);
  });
});

describe("Listen through, in the Hear row", () => {
  beforeEach(() => {
    // A browser that can listen: the microphones and the picker are shown.
    vi.stubGlobal("SpeechRecognition", class {});
    // Radix's menu measures itself, which jsdom cannot.
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  test("Find Inputs until the inputs can be named, then the menu of them; a pick is taken", async () => {
    card();
    const hear = within(screen.getByTestId("clearance-detail-hear"));
    // The card holds the input while it is open.
    expect(audioInput.hold).toHaveBeenCalled();
    expect(hear.queryByTestId("listen-input")).toBeNull();
    fireEvent.click(hear.getByTestId("listen-find"));
    expect(audioInput.find).toHaveBeenCalled();
    const menu = await hear.findByTestId("listen-input");
    expect(menu.getAttribute("aria-label")).toBe("Listen through: Choose");
    fireEvent.keyDown(menu, { key: "Enter" });
    const options = await screen.findAllByTestId("listen-input-option");
    expect(options.map(o => o.textContent)).toEqual(["iPhone Microphone", "GMA 350c"]);
    fireEvent.click(options[1]!);
    expect(audioInput.pick).toHaveBeenCalledWith("gma");
  });

  test("what is heard, by its name, with its level", () => {
    card();
    act(() => useAtcRadio.setState({ input: { label: "GMA 350c", outside: true, lost: false, instead: null } }));
    const hearing = screen.getByTestId("listen-hearing");
    expect(hearing.textContent).toBe("HearingGMA 350c");
    expect(within(hearing).getByTestId("waveform")).toBeTruthy();
    // Not the phone at the speaker any more.
    expect((screen.getByTestId("clearance-text") as HTMLTextAreaElement).placeholder).toMatch(/^Tap the microphone, or type it as read: /);
    expect(screen.queryByTestId("clearance-error")).toBeNull();
  });

  test("the input chosen gone: the card's error line says so, and what is heard instead", () => {
    card();
    act(() => useAtcRadio.setState({ input: { label: "GMA 350c", outside: true, lost: true, instead: "iPhone Microphone" } }));
    expect(screen.getByTestId("clearance-error").textContent).toBe("GMA 350c disconnected; hearing the iPhone microphone");
    expect(screen.getByTestId("listen-hearing").textContent).toBe("HearingiPhone Microphone");
  });

  test("a choice that could not be had is said in the card's error line", () => {
    card();
    act(() => audioInput.useInputs.setState({ problem: "Microphone access was refused; allow it for Wingtip Maps in Settings." }));
    expect(screen.getByTestId("clearance-error").textContent).toBe("Microphone access was refused; allow it for Wingtip Maps in Settings.");
  });
});
