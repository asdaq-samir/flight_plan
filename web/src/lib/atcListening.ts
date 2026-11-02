/**
 * Listening to the radio (lib/atcRadio's store): each transmission as
 * lib/listen hears it, marked where it was said to us (lib/heardCall).
 * Once, from the map's microphone -- the pill types what is said and it
 * ends at a pause or a second tap, as Siri does (the owner's pick,
 * 2026-11-02) -- or on and on from the Radio card, for the captions and
 * our calls. In a chunk of its own, so the first load carries none of it.
 */
import { useAtcRadio } from "./atcRadio";
import { ourCall } from "./heardCall";
import { listen } from "./listen";

/** As many transmissions as are kept: a long flight's radio is not. */
const KEPT = 60;
/** Once words have come, this long with no more ends listening once, ms:
 *  the pause after a transmission. */
const PAUSE_MS = 1800;
/** With nothing said at all, listening once ends after this long, ms. */
const NOTHING_MS = 8000;
/** Listening once ends after this long whatever is said, ms. */
const LONGEST_MS = 30000;

let stopping: (() => void) | null = null;

/** A transmission heard, kept in the log; answers the store's new one. */
function record(id: number, text: string, final: boolean) {
  useAtcRadio.setState(s => {
    // A call to us only while the radio is listened to on and on: once,
    // the pill is the pilot's own and offers its chips itself.
    const forUs = s.mode === "radio" && !!s.tail && ourCall(text, s.tail);
    const was = s.heard.find(t => t.id === id);
    const next = { id, at: was?.at ?? Date.now(), text, final, forUs };
    // A call to us, once settled: the phone buzzes where it can (not
    // Safari, which has no vibration).
    if (forUs && final && !was?.final && s.mode === "radio") navigator.vibrate?.(200);
    return { heard: was ? s.heard.map(t => (t.id === id ? next : t)) : [...s.heard, next].slice(-KEPT) };
  });
}

/** Listens on and on from the Radio card, `words` the names near the
 *  route to expect, `callPattern` our call sign for the iOS app to look
 *  for while locked. */
export async function startRadio(words: string[], callPattern?: string) {
  if (useAtcRadio.getState().listening) return;
  useAtcRadio.setState({ listening: true, mode: "radio", error: null });
  const { stop } = await listen(words, callPattern, (id, text, final) => {
    if (text) record(id, text, final);
  }, error => {
    stopping = null;
    useAtcRadio.setState({ listening: false, mode: null, error: error ?? null });
  });
  stopping = stop;
}

/** Listens once, the pill typing what is said: ended by a pause after
 *  words, by nothing said at all, or by the pilot's second tap. */
export async function listenOnce(words: string[]) {
  if (useAtcRadio.getState().listening) return;
  useAtcRadio.setState({ listening: true, mode: "once", error: null, pill: { listening: true, text: "", error: null } });
  const said = new Map<number, string>();
  let quiet = window.setTimeout(() => stopRadio(), NOTHING_MS);
  const longest = window.setTimeout(() => stopRadio(), LONGEST_MS);
  const { stop } = await listen(words, undefined, (id, text) => {
    if (!text) return;
    record(id, text, true);
    said.set(id, text);
    const typed = [...said.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).join(" ");
    useAtcRadio.setState(s => ({ pill: s.pill && { ...s.pill, text: typed } }));
    window.clearTimeout(quiet);
    quiet = window.setTimeout(() => stopRadio(), PAUSE_MS);
  }, error => {
    stopping = null;
    window.clearTimeout(quiet);
    window.clearTimeout(longest);
    useAtcRadio.setState(s => ({
      listening: false, mode: null,
      pill: s.pill && { ...s.pill, listening: false, error: error ?? (s.pill.text ? null : "Nothing was heard. Tap the microphone and speak, or hold the phone to the speaker.") },
    }));
  });
  stopping = stop;
}

export function stopRadio() {
  stopping?.();
}
