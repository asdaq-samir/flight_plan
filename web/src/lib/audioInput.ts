/**
 * The input the radio is heard through. A phone has no airband receiver,
 * so the radio reaches it from the airplane's audio panel or headset over
 * Bluetooth (the hands-free link, which an iPhone takes as a microphone)
 * or a cable: the owner's "can the mic button tune into a frequency?" and
 * "Bluetooth is fine", 2026-11-04. This holds the input chosen for that,
 * meters it, and says which input is live and when it goes.
 *
 * Safari's recognizer cannot be handed a device: it records the audio
 * route's default input (WebKit's SpeechRecognitionCaptureSource), and a
 * plain capture there mostly lands on the iPhone's own microphone even
 * with a headset connected (WebKit bug 282939). So the page moves the
 * route: a capture held on the chosen input by its exact id is what makes
 * WebKit ask iOS for it (setPreferredInput), and the held track's name is
 * the only word the page gets of what is live, and of a change or a drop.
 * Where the recognizer takes a track (lib/listen's takesTrack: Chrome and
 * Edge, Firefox 160, on the desktop) it hears exactly this one.
 *
 * Holds are counted -- the Radio card's picker while it is open, and each
 * listening -- and the input is let go at none, so the microphone is never
 * held for nothing. Nothing heard is sent anywhere or saved: the level is
 * a number for the bars, gone as it is drawn.
 *
 * Imported by lib/atcListening, lib/atis and the card's ListenThrough, all
 * chunks of their own, never by lib/listen, which the first load carries.
 * Every browser call is feature-tested and caught; where nothing can be
 * picked -- Chrome for Android, whose recognizer opens the microphone itself and whose
 * inputs are only "Bluetooth headset" and "Default" -- all of it does
 * nothing, and listening is as it always was.
 */
import { create } from "zustand";
import { inputLevel, useAtcRadio, type HeardInput } from "./atcRadio";
import { noMicrophone, takesTrack } from "./listen";
import { usePreferences } from "./preferences";

/** One input, as enumerateDevices lists it once the page may see names. */
export interface Input {
  id: string;
  label: string;
  outside: boolean;
}

/** An input chosen, as preferences keep it: by id, then by name. */
export interface InputChoice {
  id: string;
  label: string;
}

/**
 * What the picker shows: whether this page load may list the inputs by
 * name yet (`found`; Safari lists them only after a capture has been
 * granted in the same page load, WebKit's ExposeCaptureDevicesAfterCapture,
 * not after the site's stored permission), the inputs, the one the held
 * track is on, and why a choice could not be had.
 */
export const useInputs = create<{ found: boolean; inputs: Input[]; chosen: string | null; problem: string | null }>(() => ({
  found: false, inputs: [], chosen: null, problem: null,
}));

/** Whether an input can be picked here at all. */
export function canPickInput(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (/Android/.test(navigator.userAgent ?? "")) return false;
  const devices = navigator.mediaDevices;
  return typeof devices?.getUserMedia === "function" && typeof devices.enumerateDevices === "function";
}

/** The device's own microphone by its name in Safari ("iPhone Microphone",
 *  "MacBook Pro Microphone"), Chrome ("… (Built-in)", "Default") and
 *  Firefox; a Windows laptop's "Microphone Array". */
const BUILT_IN = [
  /^$/,
  /^default$/i,
  /\b(iPhone|iPad|iPod)\b.*\bMicrophone\b/i,
  /\(Built-in\)/i,
  /^(MacBook( Air| Pro)?|iMac|Mac( mini| Studio| Pro)?|Studio Display|Built-in|Internal) Microphone\b/i,
  /^Microphone Array\b/i,
];

/** Whether an input is not the phone's or the computer's own microphone:
 *  a Bluetooth panel or headset, a cable's. */
export function isOutside(label: string): boolean {
  const name = label.replace(/^Default\s*-\s*/i, "").trim();
  return !BUILT_IN.some(re => re.test(name));
}

/** The level of a block of samples, 0 to 1: its RMS from -60 to 0 dBFS,
 *  so a full-scale sine reads 0.95 and silence 0. */
export function levelOf(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (!(rms > 0)) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60));
}

/** The input in a list that a choice names: by its id, else its name
 *  (Chrome's "Default - " taken off), as a private window gives a device
 *  another id. */
export function matchInput(inputs: Input[], want: InputChoice | null): Input | null {
  if (!want) return null;
  const bare = (label: string) => label.replace(/^Default\s*-\s*/i, "").trim();
  return inputs.find(i => i.id === want.id)
    ?? inputs.find(i => i.label === want.label)
    ?? inputs.find(i => bare(i.label) === bare(want.label))
    ?? null;
}

interface Held {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** The input chosen, as asked for: its name stays what was picked once
   *  the track's own changes. */
  id: string;
  label: string;
  outside: boolean;
  detach: () => void;
}

let holds = 0;
let held: Held | null = null;
let opening = false;
/** Counts each opening and each letting go, so an answer that comes after
 *  either is not taken. */
let generation = 0;
let context: AudioContext | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let meter: ReturnType<typeof setInterval> | null = null;
let sessionSet = false;
let watching = false;
/** An outside input asked for that could not be opened -- the one
 *  remembered, not connected as listening began -- said as lost until it
 *  is had, another is chosen, or the input is let go. */
let missing: InputChoice | null = null;
const switched = new Set<() => void>();

const devices = () => navigator.mediaDevices;

/** The track held, while it is live: what the recognizer is handed. */
export function heldTrack(): MediaStreamTrack | null {
  const track = held?.track;
  return track && track.readyState === "live" ? track : null;
}

/** Called each time a new track is held; returns its unsubscribe. */
export function onSwitch(fn: () => void): () => void {
  switched.add(fn);
  return () => { switched.delete(fn); };
}

/** A hold on the input; the returned function lets it go, and the input
 *  is let go with the last hold. */
export function hold(): () => void {
  if (!canPickInput()) return () => {};
  holds++;
  watch();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) letGo();
  };
}

/** The input the pilot chose, as preferences keep it. */
export function remembered(): InputChoice | null {
  try {
    return usePreferences.getState().listenInput ?? null;
  } catch {
    return null;
  }
}

function remember(choice: InputChoice) {
  // localStorage may refuse (a private window, blocked site data): the
  // choice then lasts the page.
  try {
    usePreferences.setState({ listenInput: choice });
  } catch {
    // kept for this page only
  }
}

/** The inputs listed afresh: by name once the page may see them. */
export async function refresh(): Promise<void> {
  if (!canPickInput()) return;
  try {
    const all = await devices().enumerateDevices();
    // Chrome's "default" and Windows' "communications" are the same
    // inputs again under another name.
    const inputs = all
      .filter(d => d.kind === "audioinput" && d.deviceId && d.label && d.deviceId !== "default" && d.deviceId !== "communications")
      .map(d => ({ id: d.deviceId, label: d.label, outside: isOutside(d.label) }));
    useInputs.setState({ found: inputs.length > 0, inputs });
  } catch {
    // The list stays as it was.
  }
}

/** Opens an input, the tap that lets the page list the inputs by name (the
 *  picker's Find Inputs): the outside input remembered where there is
 *  one, so that finding the inputs does not put the phone's own
 *  microphone in its place (a plain capture on an iPhone mostly lands on
 *  it, WebKit bug 282939), else the default. */
export function find(): Promise<void> {
  const want = remembered();
  return choose(want && isOutside(want.label) ? want : null);
}

/** One of the listed inputs picked, remembered for the next listening. */
export function pick(id: string): Promise<void> {
  const input = useInputs.getState().inputs.find(i => i.id === id);
  if (!input) return Promise.resolve();
  remember({ id: input.id, label: input.label });
  return choose(input);
}

/**
 * Holds `want` (null: the default input) in place of what is held, metered.
 * Call it in the tap: the AudioContext is made or resumed and the capture
 * asked for before anything is awaited, as iOS starts audio only from a
 * tap. An outside input is opened with the browser's voice processing off,
 * which on iOS takes the shared capture unit off voice processing for the
 * recognizer too (WebKit's CoreAudioCaptureUnit; untested on a phone); the
 * phone's own microphone asks for it on, as listening always had it.
 *
 * Nothing is opened once nothing holds the input: an answer that comes
 * after listening ended starts no context and no capture.
 */
export function choose(want: InputChoice | null): Promise<void> {
  if (!canPickInput() || holds === 0) return Promise.resolve();
  startContext();
  const { found, inputs, chosen } = useInputs.getState();
  // The list is a hint, not a gate: it is not read again while nothing
  // holds an input, so a panel back since then (the avionics master on
  // again after the engine's start) is asked for by its id all the same,
  // and a real absence is the browser's answer (failed).
  const known = want && found ? matchInput(inputs, want) : null;
  // The one already held and live: nothing to open again.
  if (known && known.id === chosen && heldTrack() && !opening) return Promise.resolve();
  const gen = ++generation;
  const target = known ?? want;
  const outside = !!target && isOutside(target.label);
  // A switch: the earlier track's end is no loss. On iOS a capture on
  // another microphone ends the page's earlier one (WebKit's
  // UserMediaCaptureManagerProxy, "Support multiple microphones").
  const before = held;
  before?.detach();
  opening = true;
  // A switch, too, puts Safari's session back to auto before the capture,
  // the first step of WebKit bug 282939 comment 6: WebKit takes a type set
  // again as no change (AudioSession::setCategoryOverride returns where the
  // category is the one it has), so only after auto is adopt's
  // play-and-record the change that moves iOS to the input.
  if (sessionSet) setSession("auto");
  let asked: Promise<MediaStream>;
  try {
    asked = devices().getUserMedia({ audio: constraintsFor(target, outside) });
  } catch (err) {
    asked = Promise.reject(err);
  }
  return asked.then(
    stream => adopt(stream, gen, target, before),
    err => failed(err, gen, want, target, before, !!known),
  );
}

/** The device's own microphone asks for the voice processing listening
 *  always had: on iOS a new capture takes the shared unit's state as it
 *  stands (WebKit's CoreAudioCaptureUnit; the research's claim 28), which
 *  an outside input opened before has turned off. */
function constraintsFor(target: InputChoice | null, outside: boolean): MediaTrackConstraints {
  if (!target) return { echoCancellation: true };
  return outside
    ? { deviceId: { exact: target.id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { deviceId: { exact: target.id }, echoCancellation: true };
}

function adopt(stream: MediaStream, gen: number, target: InputChoice | null, before: Held | null) {
  if (gen === generation) opening = false;
  const track = stream.getAudioTracks()[0];
  if (gen !== generation || holds === 0 || !track) {
    stream.getTracks().forEach(t => t.stop());
    if (gen === generation && holds > 0 && before) reattach(before);
    return;
  }
  const label = target?.label || track.label;
  const next: Held = { stream, track, id: target?.id ?? settingsId(track), label, outside: isOutside(label), detach: () => {} };
  next.detach = attach(next);
  held = next;
  // Asked for by name and had: nothing chosen is missing any more. The
  // default, opened in a missing one's place, leaves it said.
  if (target) missing = null;
  if (before && before.track !== track) before.stream.getTracks().forEach(t => t.stop());
  // Only once the track is live: WebKit bug 282939 comment 6 found that
  // "play-and-record" set after the capture is what moves iOS to the
  // headset, and "playback" then "auto" after it full quality again.
  setSession("play-and-record");
  sessionSet = true;
  meterOn(stream);
  useInputs.setState({ problem: null });
  // A panel back while nothing held an input is not in the list yet: the
  // list is read again before what is live is said, not called gone.
  const { found, inputs } = useInputs.getState();
  if (!found || matchInput(inputs, { id: next.id, label })) publish();
  void refresh().then(publish);
  for (const fn of [...switched]) fn();
}

function failed(
  err: unknown, gen: number, want: InputChoice | null, target: InputChoice | null, before: Held | null, listed: boolean,
): Promise<void> | void {
  if (gen !== generation) return;
  opening = false;
  const name = (err as { name?: unknown } | null)?.name;
  const absent = name === "OverconstrainedError" || name === "NotFoundError";
  // An input asked for by an id this page load does not list (a private
  // window gives devices other ids; a panel back since the list was read):
  // the default input is opened, which lets the inputs be listed, and the
  // one with its name is chosen from them -- unless listening ended or
  // another was asked for meanwhile.
  if (want && !listed && absent) {
    const fallback = choose(null);
    const mine = generation;
    return fallback.then(refresh).then(() => {
      if (generation !== mine || holds === 0) return;
      const named = matchInput(useInputs.getState().inputs, { id: "", label: want.label });
      if (named && named.id !== useInputs.getState().chosen) return choose(named);
      // The default is the one wanted, under its id here.
      if (named) {
        missing = null;
        publish();
        return;
      }
      if (isOutside(want.label)) missing = want;
      publish();
      useInputs.setState({ problem: `${want.label} could not be found; check it is connected.` });
    });
  }
  // An outside input not to be had is said as lost where listening shows,
  // with what is heard instead, not left to the card's line alone.
  if (want && absent && isOutside(want.label)) missing = want;
  if (before) reattach(before);
  else publish();
  useInputs.setState({ problem: failWords(err, target?.label ?? null) });
}

/** Why a capture was refused, in a pilot's words. Only ever in a browser
 *  (canPickInput), where a website has no entry of its own in iOS's
 *  Settings: the browser's own settings for the site allow it. */
function failWords(err: unknown, label: string | null): string {
  const { name, message } = (err ?? {}) as { name?: unknown; message?: unknown };
  if (typeof message === "string" && /AVAudioSessionCaptureDevice/.test(message)) return noMicrophone();
  if (name === "NotAllowedError" || name === "SecurityError") {
    const ua = navigator.userAgent ?? "";
    const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(ua);
    return `Microphone access was refused; allow it in ${safari ? "Safari's" : "the browser's"} settings for this website.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `${label ?? "The microphone"} could not be found; check it is connected.`;
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `${label ?? "The microphone"} could not be used; another app may have it.`;
  }
  return noMicrophone();
}

function settingsId(track: MediaStreamTrack): string {
  try {
    return track.getSettings?.().deviceId ?? "";
  } catch {
    return "";
  }
}

/** The track's events, each a fresh reading of what is live; returns the
 *  unsubscribe. Safari renames a running capture as the route changes and
 *  says so with configurationchange (16.4+); the others only devicechange. */
function attach(h: Held): () => void {
  const on = () => publish();
  const events = ["ended", "mute", "unmute", "configurationchange"];
  for (const e of events) h.track.addEventListener(e, on);
  return () => { for (const e of events) h.track.removeEventListener(e, on); };
}

/** Back on the input held before a switch that failed, its session as it
 *  was: the switch had put it back to auto. */
function reattach(h: Held) {
  h.detach = attach(h);
  held = h;
  if (sessionSet) setSession("play-and-record");
  publish();
}

function onDeviceChange() {
  void refresh().then(publish);
}

function watch() {
  if (watching) return;
  try {
    devices().addEventListener?.("devicechange", onDeviceChange);
    watching = true;
  } catch {
    // No word of devices coming and going; the track's own events remain.
  }
}

/**
 * What is live, put in the radio's store: the track's own name now, or,
 * where the outside input chosen is not heard, that it is lost, why as far
 * as the page knows -- no longer listed, its track ended, the route moved
 * to the device's own microphone, or not to be had at all -- and what is
 * heard instead; and whether the capture is paused (muted), when no sound
 * reaches the page whatever the input sends. Read at every input event
 * and a second after listening starts (lib/atcListening), as starting
 * Safari's recognizer may move the route itself.
 */
export function publish() {
  const h = held;
  if (!h) {
    // An outside input wanted and not had, nothing in its place: the
    // recognizer hears the default.
    if (missing) useAtcRadio.setState({ input: { label: missing.label, outside: true, lost: true, why: "missing", instead: null, paused: false } });
    return;
  }
  const { track } = h;
  const live = track.readyState === "live";
  const now = track.label || h.label;
  const { found, inputs } = useInputs.getState();
  const gone = found && !matchInput(inputs, { id: h.id, label: h.label });
  const fellBack = live && !!track.label && !isOutside(track.label);
  const why: HeardInput["why"] = !h.outside ? null : gone ? "disconnected" : !live ? "ended" : fellBack ? "moved" : null;
  const input: HeardInput = why
    ? { label: h.label, outside: true, lost: true, why, instead: fellBack ? track.label : null, paused: false }
    : missing && !isOutside(now)
      ? { label: missing.label, outside: true, lost: true, why: "missing", instead: live ? now : null, paused: false }
      : { label: now, outside: isOutside(now), lost: false, why: null, instead: null, paused: live && !!track.muted };
  useAtcRadio.setState({ input });
  useInputs.setState({ chosen: input.lost ? null : (matchInput(inputs, { id: live ? settingsId(track) || h.id : h.id, label: now })?.id ?? null) });
}

function startContext() {
  const Context = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  try {
    if (!context || context.state === "closed") context = new Context();
    void context.resume?.().catch(() => {});
  } catch {
    context = null;
  }
}

/** Ten readings a second of the held stream, through an AnalyserNode that
 *  goes nowhere: nothing is played back or kept. */
function meterOn(stream: MediaStream) {
  if (!context) return;
  try {
    source?.disconnect();
    source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    if (meter) clearInterval(meter);
    meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      inputLevel.emit(levelOf(samples));
    }, 100);
  } catch {
    // No meter: the bars keep their own rise and fall.
  }
}

function setSession(type: "play-and-record" | "playback" | "auto") {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    // Safari 16.4+ only; elsewhere the session is the browser's.
  }
}

/** The last hold gone: the track stopped, the meter and its context shut,
 *  Safari's session given back, nothing named. */
function letGo() {
  generation++;
  opening = false;
  const h = held;
  held = null;
  if (h) {
    h.detach();
    h.stream.getTracks().forEach(t => t.stop());
  }
  if (meter) clearInterval(meter);
  meter = null;
  try {
    source?.disconnect();
  } catch {
    // already gone
  }
  source = null;
  if (context) void context.close?.().catch(() => {});
  context = null;
  if (sessionSet) {
    setSession("playback");
    setSession("auto");
    sessionSet = false;
  }
  missing = null;
  if (watching) {
    try {
      devices().removeEventListener?.("devicechange", onDeviceChange);
    } catch {
      // nothing to undo
    }
    watching = false;
  }
  inputLevel.emit(null);
  useInputs.setState({ chosen: null, problem: null });
  useAtcRadio.setState({ input: null });
}

/** A listening session's hold on the input, for lib/listen. */
export interface ListeningHold {
  /** The held track, read at each start of the recognizer. */
  track: () => MediaStreamTrack | null;
  /** Starts the recognizer afresh when another input is held, where it
   *  hears the track it is given. */
  follow: (renew: () => void) => void;
  release: () => void;
}

/**
 * The hold a listening takes, in the tap that starts it. After a reload
 * nothing is held: an outside input remembered is chosen in this same
 * tap, not awaited, so the recognizer still starts straight from the tap
 * as Safari asks. A second on, the name is read again, as starting the
 * recognizer may have moved the route.
 */
export function holdForListening(): ListeningHold {
  if (!canPickInput()) return { track: () => null, follow: () => {}, release: () => {} };
  const release = hold();
  // Nothing live held, or the outside input chosen not heard (its track
  // ended as the panel dropped, and the panel back since): the one
  // remembered is asked for again, unless one is being opened.
  if (!opening && (!heldTrack() || useAtcRadio.getState().input?.lost)) {
    const want = remembered();
    if (want && isOutside(want.label)) void choose(want);
  }
  const check = setTimeout(publish, 1000);
  let off = () => {};
  let done = false;
  return {
    track: heldTrack,
    follow: renew => {
      // A listening that ended before it began has nothing to follow.
      if (done) return;
      off();
      off = onSwitch(() => { if (takesTrack()) renew(); });
    },
    release: () => {
      done = true;
      clearTimeout(check);
      off();
      release();
    },
  };
}
