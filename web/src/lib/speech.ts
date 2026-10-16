/** Says a line aloud, where the browser has a voice; nothing where it has
 *  none. On an iPhone a page may speak only once a tap has let it: the
 *  first line is said from one (MapSettings' Spoken). */
export function say(words: string) {
  const voice = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!voice || typeof SpeechSynthesisUtterance === "undefined") return;
  const line = new SpeechSynthesisUtterance(words);
  line.lang = "en-US";
  voice.speak(line);
}

/** Lets the page speak later, said nothing: on an iPhone a page may speak
 *  only once a tap has let it, so a tap that sets up something to be said
 *  later (an airplane's alert) says an empty line in its own handler. */
export function primeSpeech() {
  const voice = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!voice || typeof SpeechSynthesisUtterance === "undefined") return;
  voice.speak(new SpeechSynthesisUtterance(""));
}
