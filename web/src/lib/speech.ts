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
