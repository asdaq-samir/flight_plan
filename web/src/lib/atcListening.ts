/**
 * Listening to the radio (lib/atcRadio's store): each transmission as
 * lib/listen hears it, marked where it was said to us (lib/heardCall).
 * Once, from the map's microphone -- the pill types what is said and it
 * ends at a pause or a second tap, as Siri does (the owner's pick,
 * 2026-11-02) -- or on and on from the Radio card, for the captions and
 * our calls. In a chunk of its own, so the first load carries none of it.
 *
 * Both hear through the input lib/audioInput holds, a Bluetooth audio
 * panel's or headset's link or a cable where the pilot chose one (the
 * owner, 2026-11-04: "can the mic button tune into a frequency?",
 * "Bluetooth is fine"). An iPhone has one input route at a time, so one
 * choice serves every kind of listening, and the pill and the captions
 * say which input is chosen (lib/atcRadio's heardThrough says where the
 * recognizer is known to hear it).
 */
import { heardThrough, useAtcRadio } from "./atcRadio";
import { holdForListening } from "./audioInput";
import { ourCall } from "./heardCall";
import { listen } from "./listen";

/** As many transmissions as are kept: a long flight's radio is not. */
const KEPT = 60;
/** Once words have come, this long with no more ends listening once, ms:
 *  the pause after a transmission. */
const PAUSE_MS = 1800;
/** With nothing said at all, listening once ends after this long, ms:
 *  long enough to wait for ATC to call back. */
const NOTHING_MS = 15000;
/** Listening once ends after this long whatever is said, ms. */
const LONGEST_MS = 30000;

let stopping: (() => void) | null = null;

/** The ATIS being heard (lib/atis), stopped as the radio or the microphone
 *  starts: one recognizer at a time, as two in a page cut each other off
 *  and each listen() starts its own again. The tap that starts listening
 *  wins, the ATIS row saying why it stopped. */
function stopAtis() {
  useAtcRadio.getState().atisStop?.();
}

/** A transmission heard, kept in the log; answers the store's new one. */
function record(id: number, text: string, final: boolean) {
  useAtcRadio.setState(s => {
    // A call to us only while the radio is listened to on and on: once,
    // the pill is the pilot's own and offers its chips itself.
    const forUs = s.mode === "radio" && !!s.tail && ourCall(text, s.tail);
    // The same transmission under a new number -- Safari's recognizer
    // gives a finished phrase again, and again after it restarts -- is
    // the last one over again, not another (listenOnce the same way).
    const last = s.heard.at(-1);
    const again = !!last && last.id < id && !s.heard.some(t => t.id === id) && last.text.toLowerCase() === text.toLowerCase();
    const was = again ? last : s.heard.find(t => t.id === id);
    const next = { id: was?.id ?? id, at: was?.at ?? Date.now(), text, final, forUs };
    // A call to us, once settled: the phone buzzes where it can (not
    // Safari, which has no vibration).
    if (forUs && final && !was?.final && s.mode === "radio") navigator.vibrate?.(200);
    return { heard: was ? s.heard.map(t => (t.id === was.id ? next : t)) : [...s.heard, next].slice(-KEPT) };
  });
}

/** Listens on and on from the Radio card, `words` the names near the
 *  route to expect, `callPattern` our call sign for the iOS app to look
 *  for while locked. */
export async function startRadio(words: string[], callPattern?: string) {
  if (useAtcRadio.getState().listening) return;
  stopAtis();
  useAtcRadio.setState({ listening: true, mode: "radio", error: null });
  // Before the recognizer, in the same tap: the input held, or the one
  // remembered being opened.
  const input = holdForListening();
  const { stop, renew } = await listen(words, callPattern, (id, text, final) => {
    if (text) record(id, text, final);
  }, error => {
    stopping = null;
    input.release();
    useAtcRadio.setState({ listening: false, mode: null, error: error ?? null });
  }, input.track);
  input.follow(renew);
  stopping = stop;
}

/** Listens once, the pill typing what is said: ended by a pause after
 *  words, by nothing said at all, or by the pilot's second tap. For a
 *  readback, `readbackOf` is the clearance it is checked against
 *  (RadioLayer, lib/readback). */
export async function listenOnce(words: string[], readbackOf: string | null = null) {
  if (useAtcRadio.getState().listening) return;
  stopAtis();
  useAtcRadio.setState({ listening: true, mode: "once", error: null, pill: { listening: true, text: "", error: null, readbackOf } });
  const said = new Map<number, string>();
  let quiet = window.setTimeout(() => stopRadio(), NOTHING_MS);
  const longest = window.setTimeout(() => stopRadio(), LONGEST_MS);
  const input = holdForListening();
  const { stop, renew } = await listen(words, undefined, (id, text) => {
    if (!text) return;
    record(id, text, true);
    // The same words again under a new number, or the last words with
    // more after them, are the last result over again, not a new one:
    // Safari's recognizer gives a finished phrase again as a new result,
    // and again after it starts itself afresh, and the pill read "Plan a
    // trip to Las Vegas Plan a trip to Las Vegas" (the owner's screenshot,
    // 2026-11-03).
    const last = [...said.keys()].filter(k => k < id).sort((a, b) => b - a)[0];
    if (last !== undefined) {
      const before = said.get(last)!.toLowerCase(), now = text.toLowerCase();
      if (now === before || now.startsWith(before) || before.startsWith(now)) said.delete(last);
    }
    said.set(id, text);
    const typed = [...said.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).join(" ");
    useAtcRadio.setState(s => ({ pill: s.pill && { ...s.pill, text: typed } }));
    window.clearTimeout(quiet);
    quiet = window.setTimeout(() => stopRadio(), PAUSE_MS);
  }, error => {
    stopping = null;
    window.clearTimeout(quiet);
    window.clearTimeout(longest);
    // Said before the input is let go, while its name is still known; in
    // words for a cable or a panel alike, as the page cannot tell them
    // apart.
    const name = heardThrough(useAtcRadio.getState().input);
    const nothing = name
      ? `Nothing was heard through ${name}. Check it is sending the radio: an audio panel's recording mode, or the cable.`
      : "Nothing was heard. Tap the microphone and speak, or hold the phone to the speaker.";
    useAtcRadio.setState(s => ({
      listening: false, mode: null,
      pill: s.pill && { ...s.pill, listening: false, error: error ?? (s.pill.text ? null : nothing) },
    }));
    input.release();
  }, input.track);
  input.follow(renew);
  stopping = stop;
}

export function stopRadio() {
  stopping?.();
}
