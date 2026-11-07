// @vitest-environment jsdom
/**
 * The input the radio is heard through (lib/audioInput), against stand-ins
 * for what Safari gives a page: navigator.mediaDevices listing nothing by
 * name until a capture is granted (WebKit's ExposeCaptureDevicesAfterCapture)
 * and then "iPhone Microphone" and "GMA 350c", tracks that end and rename
 * themselves as the route moves, an AudioContext whose analyser reads a
 * known sine, and navigator.audioSession (Safari 16.4+). Each test has the
 * module afresh, as a page load does.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const IPHONE = { id: "iphone", label: "iPhone Microphone" };
const PANEL = { id: "gma", label: "GMA 350c" };

class FakeTrack extends EventTarget {
  kind = "audio";
  readyState: "live" | "ended" = "live";
  muted = false;
  constructor(public label: string, public deviceId: string) { super(); }
  getSettings() { return { deviceId: this.deviceId }; }
  stop = vi.fn(() => { this.readyState = "ended"; });
  /** The device gone: as the browser ends a capture. */
  end() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
  /** Paused by the phone (a call, Siri) and going on again. */
  mute(on: boolean) { this.muted = on; this.dispatchEvent(new Event(on ? "mute" : "unmute")); }
  /** iOS moved the route: Safari renames the capture and says so. */
  reroute(label: string, deviceId: string) {
    this.label = label;
    this.deviceId = deviceId;
    this.dispatchEvent(new Event("configurationchange"));
  }
}

let granted: boolean;
let present: { id: string; label: string }[];
let tracks: FakeTrack[];
let contexts: FakeContext[];
let sessionLog: string[];
/** Each getUserMedia's answer, held until let through where a test asks. */
let hold: boolean;
let pending: (() => void)[];

class FakeContext {
  state = "running";
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    fftSize: 2048,
    // A full-scale sine, 32 samples a cycle.
    getFloatTimeDomainData: (samples: Float32Array) => { for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * i) / 32); },
  }));
  constructor() { contexts.push(this); }
}

function mediaDevices() {
  const devices = Object.assign(new EventTarget(), {
    enumerateDevices: vi.fn(async () => (granted
      ? present.map(d => ({ kind: "audioinput", deviceId: d.id, label: d.label, groupId: "" }))
      : [{ kind: "audioinput", deviceId: "", label: "", groupId: "" }])),
    getUserMedia: vi.fn((constraints: { audio: { deviceId?: { exact: string } } }) => {
      // No device asked for: the route's own, the first.
      const id = constraints.audio.deviceId?.exact ?? present[0]!.id;
      const device = present.find(d => d.id === id);
      if (!device) return Promise.reject(Object.assign(new Error("no such device"), { name: "OverconstrainedError" }));
      const answer = () => {
        granted = true;
        const track = new FakeTrack(device.label, device.id);
        tracks.push(track);
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      };
      if (!hold) return Promise.resolve(answer());
      return new Promise(resolve => pending.push(() => resolve(answer())));
    }),
  });
  return devices;
}

function stubBrowser({ userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Safari/605.1.15", audioSession = true } = {}) {
  const devices = mediaDevices();
  const session = { set type(type: string) { sessionLog.push(type); }, get type() { return sessionLog.at(-1) ?? "auto"; } };
  vi.stubGlobal("navigator", { userAgent, mediaDevices: devices, ...(audioSession ? { audioSession: session } : {}) });
  vi.stubGlobal("AudioContext", FakeContext);
  return devices;
}

/** The module and the stores it writes, afresh. */
async function load() {
  const audio = await import("./audioInput");
  const { useAtcRadio, inputLevel, lostWords } = await import("./atcRadio");
  const { usePreferences } = await import("./preferences");
  return { ...audio, useAtcRadio, inputLevel, lostWords, usePreferences };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** The held prompt answered, once the module has asked for it: taken at
 * once, it failed now and then in a full, loaded run ("pending.shift(...)
 * is not a function") when the ask was still a few awaits away. */
async function answerPrompt() {
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0), { timeout: 2000, interval: 5 });
  pending.shift()!();
}

beforeEach(() => {
  vi.resetModules();
  granted = false;
  present = [IPHONE, PANEL];
  tracks = [];
  contexts = [];
  sessionLog = [];
  hold = false;
  pending = [];
  try { localStorage.clear(); } catch { /* a stub that throws */ }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the inputs", () => {
  test("nothing is named before this page load's first grant (Find Inputs); after it, the inputs, built-in told from outside", async () => {
    stubBrowser();
    const m = await load();
    const release = m.hold();
    await m.refresh();
    expect(m.useInputs.getState().found).toBe(false);
    await m.find();
    await settle();
    expect(m.useInputs.getState()).toMatchObject({
      found: true,
      inputs: [{ id: "iphone", label: "iPhone Microphone", outside: false }, { id: "gma", label: "GMA 350c", outside: true }],
    });
    release();
  });

  test("the device's own microphone by its name in each browser, and outside inputs", async () => {
    const { isOutside } = await load();
    for (const own of ["iPhone Microphone", "iPad Microphone", "MacBook Pro Microphone", "MacBook Air Microphone", "Default", "",
      "Default - MacBook Pro Microphone (Built-in)", "MacBook Pro Microphone (Built-in)", "Microphone Array (Realtek Audio)"]) {
      expect(isOutside(own), own).toBe(false);
    }
    for (const outside of ["GMA 350c", "PMA450B", "AirPods Pro", "USB Audio", "Default - GMA 350c (Bluetooth)"]) {
      expect(isOutside(outside), outside).toBe(true);
    }
  });
});

describe("opening an input", () => {
  test("an outside input by its exact id with the voice processing off; the phone's own by its id with it asked on; Find Inputs the default, with it on", async () => {
    const devices = stubBrowser();
    const m = await load();
    const release = m.hold();
    await m.find();
    await settle();
    // On: a capture on iOS takes the shared unit's voice processing as an
    // earlier one left it (WebKit's CoreAudioCaptureUnit).
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({ audio: { echoCancellation: true } });
    await m.pick("gma");
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: "gma" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(m.heldTrack()?.label).toBe("GMA 350c");
    expect(m.useAtcRadio.getState().input).toEqual({ label: "GMA 350c", outside: true, lost: false, why: null, instead: null, paused: false });
    // The one before is stopped once the new one is live, and its end is no loss.
    expect(tracks[0]!.stop).toHaveBeenCalled();
    await m.pick("iphone");
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: "iphone" }, echoCancellation: true } });
    expect(m.useAtcRadio.getState().input).toEqual({ label: "iPhone Microphone", outside: false, lost: false, why: null, instead: null, paused: false });
    expect(m.usePreferences.getState().listenInput).toEqual(IPHONE);
    release();
  });

  test("Find Inputs opens the outside input remembered, not the phone's own in its place", async () => {
    const devices = stubBrowser();
    const m = await load();
    m.usePreferences.setState({ listenInput: PANEL });
    const release = m.hold();
    await m.find();
    await settle();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: "gma" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(m.useInputs.getState()).toMatchObject({ found: true, chosen: "gma" });
    release();
  });

  test("nothing is opened once nothing holds the input", async () => {
    const devices = stubBrowser();
    const m = await load();
    await m.choose(PANEL);
    expect(devices.getUserMedia).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  test("Safari's session is play-and-record only once the track is live, and playback then auto as it is let go", async () => {
    stubBrowser();
    hold = true;
    const m = await load();
    const release = m.hold();
    const opened = m.find();
    // Asked for in the tap, the context made then too; the session not yet.
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.resume).toHaveBeenCalled();
    expect(sessionLog).toEqual([]);
    await answerPrompt();
    await opened;
    expect(sessionLog).toEqual(["play-and-record"]);
    release();
    expect(sessionLog).toEqual(["play-and-record", "playback", "auto"]);
  });

  test("a switch puts the session back to auto before the capture, so play-and-record after it is a change WebKit takes", async () => {
    stubBrowser();
    const m = await load();
    const release = m.hold();
    await m.find();
    await settle();
    hold = true;
    const picked = m.pick("gma");
    expect(sessionLog).toEqual(["play-and-record", "auto"]);
    await answerPrompt();
    await picked;
    expect(sessionLog).toEqual(["play-and-record", "auto", "play-and-record"]);
    release();
  });

  test("refused in another browser: its own settings for the website", async () => {
    const devices = stubBrowser({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/142.0 Safari/537.36", audioSession: false });
    devices.getUserMedia.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
    const m = await load();
    const release = m.hold();
    await m.find();
    expect(m.useInputs.getState().problem).toBe("Microphone access was refused; allow it in the browser's settings for this website.");
    release();
  });

  test("without navigator.audioSession (Chrome, Firefox) nothing throws", async () => {
    stubBrowser({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/142.0", audioSession: false });
    const m = await load();
    const release = m.hold();
    await m.find();
    await m.pick("gma");
    expect(m.heldTrack()?.label).toBe("GMA 350c");
    expect(() => release()).not.toThrow();
  });

  test("a refusal is said where the input was picked", async () => {
    const devices = stubBrowser();
    devices.getUserMedia.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
    const m = await load();
    const release = m.hold();
    await m.find();
    // A website has no entry of its own in iOS's Settings.
    expect(m.useInputs.getState().problem).toBe("Microphone access was refused; allow it in Safari's settings for this website.");
    // iOS 26's lost microphone (WebKit bug 319706): relaunch Safari.
    devices.getUserMedia.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("No AVAudioSessionCaptureDevice"), { name: "NotAllowedError" })));
    await m.find();
    expect(m.useInputs.getState().problem).toMatch(/^No microphone could be used\..*close Safari and open it again\.$/);
    release();
  });
});

describe("an input lost", () => {
  async function onThePanel() {
    const devices = stubBrowser();
    const m = await load();
    const release = m.hold();
    await m.find();
    await settle();
    await m.pick("gma");
    await settle();
    return { m, devices, release, track: tracks.at(-1)! };
  }

  test("its track ended: no longer heard, not called disconnected while it is still listed", async () => {
    const { m, release, track } = await onThePanel();
    track.end();
    expect(m.useAtcRadio.getState().input).toEqual({ label: "GMA 350c", outside: true, lost: true, why: "ended", instead: null, paused: false });
    expect(m.lostWords(m.useAtcRadio.getState().input!)).toBe("GMA 350c is no longer heard; hearing the default microphone");
    // The recognizer is handed no ended track: it hears the default.
    expect(m.heldTrack()).toBeNull();
    release();
  });

  test("no longer listed when the devices change: disconnected", async () => {
    const { m, devices, release } = await onThePanel();
    present = [IPHONE];
    devices.dispatchEvent(new Event("devicechange"));
    await settle();
    const input = m.useAtcRadio.getState().input!;
    expect(input).toMatchObject({ label: "GMA 350c", lost: true, why: "disconnected" });
    expect(m.lostWords(input)).toBe("GMA 350c disconnected; hearing the default microphone");
    release();
  });

  test("the route moved to the iPhone's microphone with the panel still listed, and back again", async () => {
    const { m, release, track } = await onThePanel();
    track.reroute("iPhone Microphone", "iphone");
    const input = m.useAtcRadio.getState().input!;
    expect(input).toEqual({ label: "GMA 350c", outside: true, lost: true, why: "moved", instead: "iPhone Microphone", paused: false });
    expect(m.lostWords(input)).toBe("Not hearing GMA 350c, the iPhone microphone took over; choose it again in Listen through");
    // Not shown as chosen, so it can be chosen again.
    expect(m.useInputs.getState().chosen).toBeNull();
    track.reroute("GMA 350c", "gma");
    expect(m.useAtcRadio.getState().input).toEqual({ label: "GMA 350c", outside: true, lost: false, why: null, instead: null, paused: false });
    release();
  });

  test("paused by the phone, and going on", async () => {
    const { m, release, track } = await onThePanel();
    track.mute(true);
    expect(m.useAtcRadio.getState().input).toMatchObject({ label: "GMA 350c", lost: false, paused: true });
    track.mute(false);
    expect(m.useAtcRadio.getState().input).toMatchObject({ label: "GMA 350c", lost: false, paused: false });
    release();
  });

  test("its track ended and the panel back: the next listening opens it again", async () => {
    const { m, devices, release, track } = await onThePanel();
    track.end();
    const listening = m.holdForListening();
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: "gma" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await settle();
    expect(listening.track()?.label).toBe("GMA 350c");
    expect(listening.track()).not.toBe(track);
    expect(m.useAtcRadio.getState().input).toMatchObject({ label: "GMA 350c", lost: false });
    listening.release();
    release();
  });
});

describe("the list a hint", () => {
  test("a panel back while nothing held an input, not in the list kept: asked for by its id all the same, and not called lost", async () => {
    const devices = stubBrowser();
    const m = await load();
    const card = m.hold();
    await m.find();
    await settle();
    await m.pick("gma");
    await settle();
    // The master off: the panel leaves the list; then nothing holds an input.
    present = [IPHONE];
    devices.dispatchEvent(new Event("devicechange"));
    await settle();
    card();
    // The master on again, unheard: nothing listened for devices.
    present = [IPHONE, PANEL];
    const seen: (boolean | undefined)[] = [];
    const off = m.useAtcRadio.subscribe(s => seen.push(s.input?.lost));
    const listening = m.holdForListening();
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: "gma" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    for (let i = 0; i < 3; i++) await settle();
    expect(listening.track()?.label).toBe("GMA 350c");
    expect(m.useAtcRadio.getState().input).toMatchObject({ label: "GMA 350c", lost: false });
    expect(m.useInputs.getState().problem).toBeNull();
    // Never said lost on the way, the list read before it was named.
    expect(seen).not.toContain(true);
    off();
    listening.release();
  });

  test("the panel remembered not connected as listening begins: said as not found, with what is heard instead", async () => {
    stubBrowser();
    present = [IPHONE];
    const m = await load();
    m.usePreferences.setState({ listenInput: PANEL });
    const listening = m.holdForListening();
    for (let i = 0; i < 6; i++) await settle();
    const input = m.useAtcRadio.getState().input!;
    expect(input).toEqual({ label: "GMA 350c", outside: true, lost: true, why: "missing", instead: "iPhone Microphone", paused: false });
    expect(m.lostWords(input)).toBe("GMA 350c not found; hearing the iPhone microphone");
    expect(m.useInputs.getState().problem).toBe("GMA 350c could not be found; check it is connected.");
    listening.release();
    expect(m.useAtcRadio.getState().input).toBeNull();
  });

  test("listening ended while the default was being opened in a private window: nothing more is opened", async () => {
    const devices = stubBrowser();
    const m = await load();
    m.usePreferences.setState({ listenInput: { id: "old-id", label: "GMA 350c" } });
    hold = true;
    const listening = m.holdForListening();
    await settle();
    // The id refused; the default asked for, its prompt not yet answered.
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
    listening.release();
    await answerPrompt();
    for (let i = 0; i < 5; i++) await settle();
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(tracks.every(t => t.readyState === "ended")).toBe(true);
    // Only the one context, shut with the release.
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.state).toBe("closed");
  });
});

describe("holds", () => {
  test("the input is held while anything holds it, and let go with the last: the track stopped, the context shut, nothing named", async () => {
    stubBrowser();
    const m = await load();
    const card = m.hold();
    await m.find();
    await m.pick("gma");
    const listening = m.hold();
    const track = tracks.at(-1)!;
    card();
    card();
    expect(track.stop).not.toHaveBeenCalled();
    expect(m.heldTrack()).toBe(track);
    listening();
    expect(track.stop).toHaveBeenCalled();
    expect(contexts[0]!.close).toHaveBeenCalled();
    expect(m.heldTrack()).toBeNull();
    expect(m.useAtcRadio.getState().input).toBeNull();
  });

  test("an answer after the last hold is let go is stopped, not kept", async () => {
    stubBrowser();
    hold = true;
    const m = await load();
    const release = m.hold();
    const opened = m.find();
    release();
    await answerPrompt();
    await opened;
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(m.heldTrack()).toBeNull();
  });
});

describe("the level", () => {
  test("silence is 0, a full-scale sine about 1, and louder is held to 1", async () => {
    const { levelOf } = await load();
    expect(levelOf(new Float32Array(256))).toBe(0);
    const sine = Float32Array.from({ length: 256 }, (_, i) => Math.sin((2 * Math.PI * i) / 32));
    expect(levelOf(sine)).toBeCloseTo(0.95, 2);
    expect(levelOf(sine.map(s => s * 4))).toBe(1);
    // A tenth of full scale, -23 dBFS: well down the bars.
    expect(levelOf(sine.map(s => s / 10))).toBeCloseTo(0.62, 2);
  });

  test("measured ten times a second while held, and null once let go", async () => {
    stubBrowser();
    const m = await load();
    const levels: (number | null)[] = [];
    m.inputLevel.listen(level => levels.push(level));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const release = m.hold();
    await m.find();
    await settle();
    // A switch meters the new input in the old one's place, once.
    await m.pick("gma");
    vi.advanceTimersByTime(300);
    expect(levels.filter(l => l !== null)).toHaveLength(3);
    expect(levels.at(-1)).toBeCloseTo(0.95, 2);
    release();
    expect(levels.at(-1)).toBeNull();
  });
});

describe("the input remembered", () => {
  test("matched by its id, then by its name", async () => {
    const { matchInput } = await load();
    const inputs = [{ id: "a", label: "iPhone Microphone", outside: false }, { id: "b", label: "GMA 350c", outside: true }];
    expect(matchInput(inputs, { id: "b", label: "something else" })?.id).toBe("b");
    expect(matchInput(inputs, { id: "new-id", label: "GMA 350c" })?.id).toBe("b");
    expect(matchInput(inputs, { id: "x", label: "Default - GMA 350c" })?.id).toBe("b");
    expect(matchInput(inputs, { id: "x", label: "PMA450B" })).toBeNull();
  });

  test("after a reload, a listening opens the outside input remembered in the same call, unawaited", async () => {
    const devices = stubBrowser();
    hold = true;
    const m = await load();
    m.usePreferences.setState({ listenInput: PANEL });
    const listening = m.holdForListening();
    // Asked for before holdForListening returned: still in the tap.
    expect(devices.getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: "gma" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(listening.track()).toBeNull();
    await answerPrompt();
    await settle();
    expect(listening.track()?.label).toBe("GMA 350c");
    listening.release();
  });

  test("the phone's own microphone remembered: listening is as it always was, nothing opened", async () => {
    const devices = stubBrowser();
    const m = await load();
    m.usePreferences.setState({ listenInput: IPHONE });
    const listening = m.holdForListening();
    expect(devices.getUserMedia).not.toHaveBeenCalled();
    listening.release();
  });

  test("its id unknown to this page load (a private window): the default opened, the inputs listed, and the one by its name chosen", async () => {
    stubBrowser();
    const m = await load();
    m.usePreferences.setState({ listenInput: { id: "old-id", label: "GMA 350c" } });
    const listening = m.holdForListening();
    for (let i = 0; i < 5; i++) await settle();
    expect(listening.track()?.label).toBe("GMA 350c");
    listening.release();
  });

  test("a localStorage that throws: the pick still opens the input", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    stubBrowser();
    const m = await load();
    const release = m.hold();
    await m.find();
    await settle();
    await expect(m.pick("gma")).resolves.toBeUndefined();
    expect(m.heldTrack()?.label).toBe("GMA 350c");
    release();
  });
});

describe("where nothing can be picked", () => {
  test("Chrome for Android: every call does nothing", async () => {
    const devices = stubBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/142.0 Mobile" });
    const m = await load();
    expect(m.canPickInput()).toBe(false);
    m.usePreferences.setState({ listenInput: PANEL });
    const listening = m.holdForListening();
    await m.find();
    expect(devices.getUserMedia).not.toHaveBeenCalled();
    expect(listening.track()).toBeNull();
    listening.release();
  });
});
