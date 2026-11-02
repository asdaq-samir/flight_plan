/**
 * Listening to the radio through the phone's microphone, a transmission
 * at a time, for as long as the pilot leaves it on (lib/atcRadio): each
 * pause ends one and the next is heard afresh, so what ATC says shows as
 * it is said and a call to us can be acted on (lib/heardCall).
 *
 * - In the iOS app, Apple's own recognizer (the shell's Speech plugin,
 *   web/ios's SpeechPlugin.swift: SFSpeechRecognizer, on the phone where
 *   it can be, told the names near the route to listen for), which goes
 *   on with the phone locked (UIBackgroundModes audio) and says a call to
 *   us in a notification there.
 * - In the Android app, Android's (SpeechPlugin.java: SpeechRecognizer,
 *   with the same names as its biasing strings), while the app is open.
 * - In a browser, the Web Speech API: Safari's is Apple's recognizer,
 *   Chrome's Google's, while the page is open. Firefox has none; there a
 *   clearance is typed.
 */
import type { PluginListenerHandle } from "@capacitor/core";
import { inNativeApp } from "./native";

/** A transmission heard so far (`id` the same until it ends), and
 *  whether the recognizer has settled on it. */
export type OnHeard = (id: number, text: string, final: boolean) => void;
/** Listening has ended: stopped, or (`error`) refused or failed. */
export type OnEnded = (error?: string) => void;

interface SpeechPlugin {
  start(options: { words: string[]; callPattern?: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "heard", fn: (heard: { id: number; text: string; final: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "ended", fn: (ended: { error?: string }) => void): Promise<PluginListenerHandle>;
}

/** The browser's recognizer, where it has one; Safari's and Chrome's are
 *  still prefixed. Only what is used here. */
interface WebRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type WebRecognitionClass = new () => WebRecognition;

function webRecognition(): WebRecognitionClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: WebRecognitionClass; webkitSpeechRecognition?: WebRecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this phone or browser can listen at all. */
export function canListen(): boolean {
  return inNativeApp() || webRecognition() !== null;
}

/** The recognizer's refusal or failure in a pilot's words. */
function errorWords(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "refused") {
    return "Microphone or speech recognition access was refused; allow it for Wingtip Maps in Settings.";
  }
  if (code === "network") return "Speech recognition needs the internet here; type the clearance instead.";
  if (code === "audio-capture") return "No microphone could be used.";
  return code;
}

/**
 * Listens until `stop`, a transmission at a time. `words`, names the
 * recognizer should expect (/api/clearance/words), where it can be told
 * them; `callPattern`, our call sign as a pattern (heardCall's
 * callPattern), for the iOS app to say a call to us while it is locked.
 */
export async function listen(words: string[], callPattern: string | undefined, onHeard: OnHeard, onEnded: OnEnded): Promise<{ stop: () => void }> {
  if (inNativeApp()) {
    // The plugin's code only in the apps, as the receiver's (lib/map/receiver).
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<SpeechPlugin>("Speech");
    const handles = await Promise.all([
      plugin.addListener("heard", ({ id, text, final }) => onHeard(id, text, final)),
      plugin.addListener("ended", ({ error }) => {
        void Promise.all(handles.map(h => h.remove()));
        onEnded(error ? errorWords(error) : undefined);
      }),
    ]);
    try {
      await plugin.start({ words, callPattern });
    } catch (err) {
      void Promise.all(handles.map(h => h.remove()));
      onEnded(errorWords(err instanceof Error ? err.message : String(err)));
      return { stop: () => {} };
    }
    return { stop: () => void plugin.stop() };
  }
  const Recognition = webRecognition();
  if (!Recognition) {
    onEnded("This browser cannot listen; type the clearance instead.");
    return { stop: () => {} };
  }
  // A browser's recognizer ends by itself after a while, quiet or not:
  // started again until the pilot stops it, its transmissions numbered on.
  let stopped = false, failed: string | undefined, base = 0, seen = 0;
  const begin = () => {
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        onHeard(base + i, (result[0]?.transcript ?? "").trim(), result.isFinal);
        seen = Math.max(seen, i + 1);
      }
    };
    recognition.onerror = event => {
      // Quiet is no failure while listening to a radio.
      if (!["aborted", "no-speech"].includes(event.error)) failed = errorWords(event.error);
    };
    recognition.onend = () => {
      if (stopped || failed) {
        onEnded(failed);
        return;
      }
      base += seen;
      seen = 0;
      current = begin();
    };
    recognition.start();
    return recognition;
  };
  let current = begin();
  return { stop: () => { stopped = true; current.stop(); } };
}
