/**
 * Listening to the radio for the captions and our calls (lib/atcRadio's
 * store): each transmission as lib/listen hears it, marked where it was
 * said to us (lib/heardCall). In a chunk with the clearance card that
 * starts it, so the first load carries none of it.
 */
import { useAtcRadio } from "./atcRadio";
import { ourCall } from "./heardCall";
import { listen } from "./listen";

/** As many transmissions as are kept: a long flight's radio is not. */
const KEPT = 60;

let stopping: (() => void) | null = null;

/** Starts listening, `words` the names near the route to expect,
 *  `callPattern` our call sign for the iOS app to look for while locked. */
export async function startRadio(words: string[], callPattern?: string) {
  if (useAtcRadio.getState().listening) return;
  useAtcRadio.setState({ listening: true, error: null });
  const { stop } = await listen(words, callPattern, (id, text, final) => {
    if (!text) return;
    useAtcRadio.setState(s => {
      const forUs = !!s.tail && ourCall(text, s.tail);
      const was = s.heard.find(t => t.id === id);
      const next = { id, at: was?.at ?? Date.now(), text, final, forUs };
      // A call to us, once settled: the phone buzzes where it can (not
      // Safari, which has no vibration).
      if (forUs && final && !was?.final) navigator.vibrate?.(200);
      return { heard: was ? s.heard.map(t => (t.id === id ? next : t)) : [...s.heard, next].slice(-KEPT) };
    });
  }, error => {
    stopping = null;
    useAtcRadio.setState({ listening: false, error: error ?? null });
  });
  stopping = stop;
}

export function stopRadio() {
  stopping?.();
}
