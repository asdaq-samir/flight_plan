/**
 * Listening to the radio through the phone's microphone, words as they
 * are heard, for a clearance read into the route (lib/clearance).
 *
 * - In the iOS app, Apple's own recognizer (the shell's Speech plugin,
 *   web/ios's SpeechPlugin.swift: SFSpeechRecognizer, on the phone where
 *   it can be, told the names near the route to listen for).
 * - In the Android app, Android's (SpeechPlugin.java: SpeechRecognizer,
 *   with the same names as its biasing strings).
 * - In a browser, the Web Speech API: Safari's is Apple's recognizer,
 *   Chrome's Google's. Firefox has none; there the clearance is typed.
 */
import type { PluginListenerHandle } from "@capacitor/core";
import { inNativeApp } from "./native";

/** What was heard so far, the whole of it each time, and whether the
 *  recognizer has settled on it. */
export type OnHeard = (text: string, final: boolean) => void;
/** Listening has ended: by itself, stopped, or (`error`) refused or failed. */
export type OnEnded = (error?: string) => void;

interface SpeechPlugin {
  start(options: { words: string[] }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "heard", fn: (heard: { text: string; final: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "ended", fn: (ended: { error?: string }) => void): Promise<PluginListenerHandle>;
}

/** The browser's recognizer, where it has one; Safari's and Chrome's are
 *  still prefixed. Only what is used here. */
interface WebRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
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
  if (code === "no-speech") return "Nothing was heard. Hold the phone near the speaker and try again.";
  if (code === "network") return "Speech recognition needs the internet here; type the clearance instead.";
  if (code === "audio-capture") return "No microphone could be used.";
  return code;
}

/**
 * Listens until `stop` is called or the recognizer ends by itself (a
 * pause, on some), each update the whole of what was heard. `words`,
 * names the recognizer should expect (/api/clearance/words), where it can
 * be told them.
 */
export async function listen(words: string[], onHeard: OnHeard, onEnded: OnEnded): Promise<{ stop: () => void }> {
  if (inNativeApp()) {
    // The plugin's code only in the apps, as the receiver's (lib/map/receiver).
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<SpeechPlugin>("Speech");
    const handles = await Promise.all([
      plugin.addListener("heard", ({ text, final }) => onHeard(text, final)),
      plugin.addListener("ended", ({ error }) => {
        void Promise.all(handles.map(h => h.remove()));
        onEnded(error ? errorWords(error) : undefined);
      }),
    ]);
    try {
      await plugin.start({ words });
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
  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  let failed: string | undefined;
  recognition.onresult = event => {
    const results = Array.from(event.results);
    onHeard(results.map(r => r[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim(), results.every(r => r.isFinal));
  };
  recognition.onerror = event => { if (event.error !== "aborted") failed = errorWords(event.error); };
  recognition.onend = () => onEnded(failed);
  recognition.start();
  return { stop: () => recognition.stop() };
}
