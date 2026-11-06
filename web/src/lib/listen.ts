/**
 * Listening to the radio through the phone's microphone, a transmission
 * at a time, for as long as the pilot leaves it on (lib/atcRadio): each
 * pause ends one and the next is heard afresh, so what ATC says shows as
 * it is said and a call to us can be acted on (lib/heardCall).
 *
 * The browser's Web Speech API: Safari's is Apple's recognizer, Chrome's
 * Google's, while the page is open. Firefox has one from 160 (10 November
 * 2026) on the desktop, not on Android (MDN's compat data,
 * api/SpeechRecognition); without one a clearance is typed.
 *
 * Which input a browser's recognizer hears: the one the page hands it
 * (`track`, lib/audioInput) where it takes one -- Chrome and Edge 135+ and
 * Firefox 160 on the desktop -- and elsewhere the phone's or computer's
 * own choice, which lib/audioInput can only steer (the owner's "can the
 * mic button tune into a frequency?" and "Bluetooth is fine",
 * 2026-11-04: the radio reaches the phone from the audio panel over
 * Bluetooth or a cable, as a microphone).
 */

/** A transmission heard so far (`id` the same until it ends), and
 *  whether the recognizer has settled on it. */
export type OnHeard = (id: number, text: string, final: boolean) => void;
/** Listening has ended: stopped, or (`error`) refused or failed. */
export type OnEnded = (error?: string) => void;

/** The browser's recognizer, where it has one; Safari's and Chrome's are
 *  still prefixed. Only what is used here. */
interface WebRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** With a track where the browser takes one (takesTrack); Safari's
   *  declares start() alone, so under WebIDL the extra argument is
   *  ignored there without an error. */
  start(track?: MediaStreamTrack): void;
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
  return webRecognition() !== null;
}

/**
 * Whether the browser's recognizer hears the track it is handed
 * (start(track)): Chrome and Edge 135+ on Windows, Mac and Linux, and
 * Firefox 160 on the desktop, each with the unprefixed SpeechRecognition
 * (MDN's compat data, start's audioTrack). Safari names its recognizer
 * webkitSpeechRecognition alone and declares only start() (WebKit's
 * SpeechRecognition.idl), and Chrome for Android has no such start
 * (Chromium's MediaStreamTrackWebSpeech is desktop only): both record
 * whatever input is the default, given a track or not.
 */
export function takesTrack(): boolean {
  // ChromeOS too has the unprefixed recognizer without the track: Chromium's
  // MediaStreamTrackWebSpeech flag is stable on Linux, Mac and Windows
  // only (runtime_enabled_features.json5), and start(track) falls back to
  // start() under WebIDL elsewhere.
  if (typeof window === "undefined" || /Android|CrOS/.test(navigator.userAgent)) return false;
  return typeof (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition === "function";
}

/** No microphone could be had, and what to try, by where. A Bluetooth
 *  panel or headset may simply have gone. Safari on iOS 26.3 to 26.6
 *  loses the microphone after a media-services reset until it is opened
 *  again (WebKit bug 319706; its fix is on the 7625 line, Safari 27, not
 *  26.x), and every browser on an iPhone or iPad is WebKit; elsewhere a
 *  reload asks again. */
export function noMicrophone(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "";
  // iPadOS's Safari says it is a Mac; a touch screen gives it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  const again = !ios ? "reload the page" : /CriOS|FxiOS|EdgiOS/.test(ua) ? "close the browser and open it again" : "close Safari and open it again";
  return `No microphone could be used. If a Bluetooth audio panel or headset was the input, check it is still connected; if it is, ${again}.`;
}

/** The recognizer's refusal or failure in a pilot's words. A refusal is
 *  undone where it was given, in the browser's settings for the site: a
 *  website has no entry of its own in iOS's Settings, and words saying
 *  so sent pilots looking for one. */
function errorWords(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "refused") {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "";
    const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
    return `Microphone or speech recognition access was refused; allow it in ${safari ? "Safari's" : "the browser's"} settings for this website.`;
  }
  if (code === "network") return "Speech recognition needs the internet here; type the clearance instead.";
  if (code === "audio-capture") return noMicrophone();
  return code;
}

/** A listening, ended by `stop`; `renew` starts the browser's recognizer
 *  afresh, as it is after a pause, to take another input (`track`). */
export interface Listening {
  stop: () => void;
  renew: () => void;
}

/**
 * Listens until `stop`, a transmission at a time. `words` and
 * `callPattern` are kept for the callers' sake: a browser's recognizer
 * takes neither (the native apps listen with their own). `track`, the input lib/audioInput holds, read afresh at each start so a
 * new choice is heard from the next.
 *
 * In a browser the recognizer starts before this returns, with no await
 * before it: Safari lets a page listen only straight from the tap.
 */
export async function listen(
  _words: string[], _callPattern: string | undefined, onHeard: OnHeard, onEnded: OnEnded,
  track?: () => MediaStreamTrack | null,
): Promise<Listening> {
  const Recognition = webRecognition();
  if (!Recognition) {
    onEnded("This browser cannot listen; type the clearance instead.");
    return { stop: () => {}, renew: () => {} };
  }
  // A browser's recognizer ends by itself after a while, quiet or not:
  // started again until the pilot stops it, its transmissions numbered on.
  let stopped = false, failed: string | undefined, base = 0, seen = 0;
  const begin = () => {
    const recognition = new Recognition();
    // Stopped by `renew` to start again on another input: what it says
    // as it goes is no failure.
    let retired = false;
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
      if (!retired && !["aborted", "no-speech"].includes(event.error)) failed = errorWords(event.error);
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
    startOn(recognition, track?.() ?? null);
    return { recognition, retire: () => { retired = true; recognition.stop(); } };
  };
  let current = begin();
  return {
    stop: () => { stopped = true; current.recognition.stop(); },
    renew: () => { if (!stopped) current.retire(); },
  };
}

/** Starts a recognizer on the held input where it is live, as the Web
 *  Speech API takes one; a track it will not take (ended, not audio:
 *  InvalidStateError, as the spec and Chromium's speech_recognition.cc
 *  have it) and the default input is heard instead. */
function startOn(recognition: WebRecognition, track: MediaStreamTrack | null) {
  if (track && track.kind === "audio" && track.readyState === "live") {
    try {
      recognition.start(track);
      return;
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name !== "InvalidStateError") throw err;
    }
  }
  recognition.start();
}
