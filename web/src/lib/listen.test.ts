// @vitest-environment jsdom
/**
 * The browser's recognizer as lib/listen drives it, against a stand-in
 * that records what each start() was handed: the held input's track where
 * it is live (Chrome and Edge 135+, Firefox 160 on the desktop hear it;
 * Safari ignores it), the default input where the track will not do, a
 * fresh read of the track at each restart, and the start itself still in
 * the tap, as Safari asks.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listen, NO_MICROPHONE, takesTrack } from "./listen";

class Recognizer {
  static made: Recognizer[] = [];
  /** Throws as Chrome does for a track it will not take. */
  static refuseTracks = false;
  lang = ""; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts: unknown[][] = [];
  stop = vi.fn();
  constructor() { Recognizer.made.push(this); }
  start(...args: unknown[]) {
    this.starts.push(args);
    if (args.length && Recognizer.refuseTracks) {
      throw Object.assign(new Error("The MediaStreamTrack is not of kind 'audio' or is not of state 'live'."), { name: "InvalidStateError" });
    }
  }
}

const track = (readyState: "live" | "ended" = "live") => ({ kind: "audio", readyState }) as unknown as MediaStreamTrack;

beforeEach(() => {
  Recognizer.made = [];
  Recognizer.refuseTracks = false;
  vi.stubGlobal("SpeechRecognition", Recognizer);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the recognizer's input", () => {
  test("a live track is handed to start()", async () => {
    const live = track();
    await listen([], undefined, () => {}, () => {}, () => live);
    expect(Recognizer.made[0]!.starts).toEqual([[live]]);
  });

  test("a track refused with InvalidStateError: start() again, on the default input", async () => {
    Recognizer.refuseTracks = true;
    const live = track();
    await listen([], undefined, () => {}, () => {}, () => live);
    expect(Recognizer.made[0]!.starts).toEqual([[live], []]);
  });

  test("an ended track, or none held: start() on the default input", async () => {
    await listen([], undefined, () => {}, () => {}, () => track("ended"));
    await listen([], undefined, () => {}, () => {});
    await listen([], undefined, () => {}, () => {}, () => null);
    expect(Recognizer.made.map(r => r.starts)).toEqual([[[]], [[]], [[]]]);
  });

  test("each restart reads the track afresh: a new choice is heard from the next", async () => {
    let held: MediaStreamTrack | null = null;
    await listen([], undefined, () => {}, () => {}, () => held);
    held = track();
    Recognizer.made[0]!.onend!();
    expect(Recognizer.made[1]!.starts).toEqual([[held]]);
  });

  test("started within listen(), before it is awaited: still in the tap", () => {
    void listen([], undefined, () => {}, () => {}, () => track());
    expect(Recognizer.made).toHaveLength(1);
    expect(Recognizer.made[0]!.starts).toHaveLength(1);
  });

  test("renew starts afresh on the input now held, and what the old one says as it stops is no failure", async () => {
    const ended = vi.fn();
    let held = track();
    const { renew } = await listen([], undefined, () => {}, ended, () => held);
    const first = Recognizer.made[0]!;
    held = track();
    renew();
    expect(first.stop).toHaveBeenCalled();
    first.onerror!({ error: "audio-capture" });
    first.onend!();
    expect(ended).not.toHaveBeenCalled();
    expect(Recognizer.made[1]!.starts).toEqual([[held]]);
  });
});

describe("its failures", () => {
  test("no microphone: what to check, and Safari opened again (WebKit bug 319706)", async () => {
    const ended = vi.fn();
    await listen([], undefined, () => {}, ended);
    Recognizer.made[0]!.onerror!({ error: "audio-capture" });
    Recognizer.made[0]!.onend!();
    expect(ended).toHaveBeenCalledWith(NO_MICROPHONE);
    // clearance.spec's prefix kept.
    expect(NO_MICROPHONE).toMatch(/^No microphone could be used\. If a Bluetooth audio panel or headset was the input, check it is still connected; if it is, close Safari and open it again\.$/);
  });
});

describe("which recognizers take a track", () => {
  test("the unprefixed one on a desktop; Safari's prefixed one and Android's never", () => {
    expect(takesTrack()).toBe(true);
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", Recognizer);
    expect(takesTrack()).toBe(false);
    vi.stubGlobal("SpeechRecognition", Recognizer);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/142.0 Mobile" });
    expect(takesTrack()).toBe(false);
  });
});
