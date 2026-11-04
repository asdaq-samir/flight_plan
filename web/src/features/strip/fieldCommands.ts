/**
 * What a line typed or said into the one field means (OneField): a route
 * of idents, a place by name, one of the app's screens by its word, or a
 * question for the assistant. Pure, so the rules are tested on their own
 * (fieldCommands.test.ts); the doing is PlanWorkspace's.
 *
 * The order matters: a screen's word first ("brief", "my airplane"), so
 * "brief me" opens the Brief rather than asking about a field called
 * BRIEF; then idents alone, which are a route; then a short name with no
 * question in it, which is a place to fly to; everything else is asked.
 */
import { identOf } from "../../lib/identSchema";

/** The screens the field opens by their word. Setup's pages each by
 *  name -- the logbook, the instructor, the currency, the endorsements
 *  and the training (the checkride's page), the guide, the account, the
 *  controls -- opened straight (PlanWorkspace's openStripScreen, through
 *  useWantedPage); the mock oral and the passengers' briefing are the
 *  Brief's sections, so they open the Brief. */
export type FieldScreen =
  | "airplane" | "logbook" | "settings" | "instructor" | "currency" | "endorsements" | "training" | "guide" | "account" | "controls"
  | "brief" | "oral" | "passengers" | "nearest" | "fuel" | "food" | "stops"
  | "routes" | "altitude" | "procedures" | "navlog" | "profile" | "share" | "file" | "clearance" | "dryrun"
  | "saved" | "favorites" | "recents" | "recentRoutes" | "radio" | "map";

export type FieldCommand =
  /** Idents alone: one is the destination, from the route's departure or
   *  where the airplane is; two are the ends; more are the ends and the
   *  stops between. */
  | { kind: "route"; dep: string | null; stops: string[]; dest: string }
  /** A place by name ("Duluth", "to Las Vegas"), for the places search
   *  and the biggest field by it (PlanWorkspace's planTo). */
  | { kind: "place"; words: string }
  | { kind: "open"; screen: FieldScreen }
  /** A field's card, not a route to it: "about KDLH", "KDLH info". */
  | { kind: "field"; ident: string }
  | { kind: "ask"; question: string };

/** Each screen's words, whole, after the filler is taken off. */
const SCREEN_WORDS: Record<string, FieldScreen> = {
  "airplane": "airplane", "my airplane": "airplane", "plane": "airplane", "aircraft": "airplane", "my aircraft": "airplane",
  "airplanes": "airplane", "weight and balance": "airplane", "w&b": "airplane", "checklist": "airplane", "poh": "airplane",
  "logbook": "logbook", "log book": "logbook", "my logbook": "logbook",
  "currency": "currency", "my currency": "currency", "am i current": "currency",
  "endorsements": "endorsements", "my endorsements": "endorsements",
  "training": "training", "my training": "training", "checkride": "training", "the checkride": "training",
  "settings": "settings", "setup": "settings",
  "account": "account", "my account": "account", "sign in": "account", "sign out": "account", "pilot details": "account",
  "controls": "controls", "the controls": "controls", "quick controls": "controls",
  "pilot guide": "guide", "guide": "guide", "the guide": "guide", "help": "guide",
  "mock oral": "oral", "oral": "oral", "oral exam": "oral", "quiz me": "oral",
  "passenger briefing": "passengers", "passengers": "passengers", "brief my passengers": "passengers", "passenger brief": "passengers",
  "instructor": "instructor", "my instructor": "instructor", "instructing": "instructor", "students": "instructor",
  "brief": "brief", "brief me": "brief", "briefing": "brief", "the brief": "brief", "go no go": "brief", "go/no-go": "brief",
  "nearest": "nearest", "nearest airport": "nearest", "nearest airports": "nearest", "nrst": "nearest",
  "fuel": "fuel", "nearest fuel": "fuel", "gas": "fuel", "avgas": "fuel", "fuel stop": "fuel", "fuel stops": "fuel",
  "food": "food", "nearest food": "food", "eat": "food", "lunch": "food", "fly-in food": "food",
  "stops": "stops", "stop": "stops", "rest stops": "stops", "where to stop": "stops",
  "routes": "routes", "route options": "routes", "other routes": "routes", "ways": "routes",
  "altitude": "altitude", "altitudes": "altitude", "cruise altitude": "altitude",
  "procedures": "procedures", "procedure": "procedures", "approaches": "procedures", "approach": "procedures", "plates": "procedures",
  "pattern": "procedures", "traffic pattern": "procedures", "runways": "procedures", "runway": "procedures",
  "nav log": "navlog", "navlog": "navlog", "legs": "navlog", "checkpoints": "navlog", "the log": "navlog",
  "profile": "profile", "side view": "profile", "terrain": "profile",
  "share": "share", "export": "share", "print": "share", "save": "share", "send": "share",
  "file": "file", "file it": "file", "flight plan": "file", "file flight plan": "file", "file a flight plan": "file",
  "clearance": "clearance", "read back": "clearance", "readback": "clearance",
  "dry run": "dryrun", "dryrun": "dryrun", "fly it on paper": "dryrun", "replay": "dryrun",
  "saved": "saved", "saved flights": "saved", "my flights": "saved", "flights": "saved",
  "favorites": "favorites", "favourites": "favorites", "home": "favorites",
  "recents": "recents", "recent": "recents", "recent airports": "recents",
  "recent routes": "recentRoutes", "routes planned": "recentRoutes", "last routes": "recentRoutes", "history": "recentRoutes",
  "radio": "radio", "listen": "radio", "atc": "radio",
  "map": "map", "map settings": "map", "charts": "map", "layers": "map",
};

/** Words that only ask for a screen, taken off its front, the longer
 *  first so "show me" is not left as "me". */
const FILLER = /^(?:please\s+)?(?:let me see|show me|give me|take me to|go to|open|show|get|see|the|my)\s+/i;

/** A word that makes a line a question for the assistant, not a place. */
const QUESTION_WORDS = new Set([
  "what", "what's", "whats", "how", "how's", "is", "are", "am", "can", "could", "should", "will", "would", "do", "does", "did",
  "why", "when", "where", "which", "who", "if", "tell", "explain", "weather", "wind", "winds", "metar", "taf", "notam", "notams",
  "tfr", "tfrs", "ceiling", "visibility", "forecast", "minimums", "legal", "me", "i", "we", "my", "the", "about", "with",
]);

/** The words between idents in a route, as typed or said: "to", "via",
 *  "from", "then", "and", an arrow or a comma. */
const ROUTE_JOINERS = new Set(["to", "via", "from", "then", "and", "through", "stopping", "at", "->", "→", ">", "-"]);

const screenOf = (text: string): FieldScreen | null => {
  let bare = text.toLowerCase().replace(/[.!?]+$/, "").trim();
  for (let i = 0; i < 3 && FILLER.test(bare); i++) bare = bare.replace(FILLER, "").trim();
  return SCREEN_WORDS[bare] ?? null;
};

/** A word that is a field's ident as typed: three or four letters and
 *  digits with a digit in them (C81, 5Y8, 06C), four letters in any case
 *  (KDLH, kdlh), or three letters in capitals (ORD, DLH) -- typed small,
 *  three letters are a word ("fly", "see"), not a field. */
function identTyped(word: string): string {
  const ident = identOf(word);
  if (!ident) return "";
  if (/\d/.test(ident) || ident.length === 4) return ident;
  return word === ident ? ident : "";
}

/** Idents alone, in order, with the route's joiners between them; null
 *  where any word is not an ident. "KDLH from C81" is C81 to KDLH; the
 *  idents after "via" are stops wherever they are said ("C81 to KDLH via
 *  KJVL"), up to the next "to". */
function routeOf(text: string): { dep: string | null; stops: string[]; dest: string } | null {
  const words = text.replace(/[,→>]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const idents: string[] = [];
  const via: string[] = [];
  let fromAt = -1;
  let viaRun = false;
  for (const word of words) {
    const lower = word.toLowerCase();
    if (ROUTE_JOINERS.has(lower)) {
      if (lower === "from") { fromAt = idents.length; viaRun = false; }
      else if (lower === "via" || lower === "through" || lower === "stopping") viaRun = true;
      else if (lower === "to") viaRun = false;
      continue;
    }
    const ident = identTyped(word);
    if (!ident) return null;
    (viaRun ? via : idents).push(ident);
  }
  if (!idents.length) return null;
  // "KDLH from C81": the ident after "from" is the departure.
  if (fromAt > 0 && fromAt < idents.length) {
    const dep = idents[fromAt]!;
    const rest = [...idents.slice(0, fromAt), ...idents.slice(fromAt + 1)];
    return { dep, stops: [...rest.slice(0, -1), ...via], dest: rest.at(-1)! };
  }
  if (idents.length === 1) return { dep: null, stops: via, dest: idents[0]! };
  return { dep: idents[0]!, stops: [...idents.slice(1, -1), ...via], dest: idents.at(-1)! };
}

/** A place by name: "to Duluth", "fly to Las Vegas", "plan a trip to
 *  Madison", or a short name with no question in it. */
function placeOf(text: string): string | null {
  const bare = text.trim().replace(/[.!]+$/, "");
  if (/\?/.test(bare)) return null;
  const to = /^(?:(?:please\s+)?(?:plan(?:\s+a)?(?:\s+trip|\s+route|\s+flight)?|fly|go|route|take me|direct|head|let's go|lets go)\s+)?to\s+(.+)$/i.exec(bare);
  if (to) return to[1]!.trim() || null;
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  if (words.some(w => QUESTION_WORDS.has(w.toLowerCase()))) return null;
  return bare;
}

/** A field's card asked for by its ident: "about KDLH", "info on C81",
 *  "KDLH card", "KDLH airport". */
function fieldOf(text: string): string | null {
  const m = /^(?:(?:about|info(?: on)?|tell me about|what about)\s+(\S+)|(\S+)\s+(?:card|info|airport|field|details))$/i.exec(text.trim());
  if (!m) return null;
  return identTyped(m[1] ?? m[2] ?? "") || null;
}

/** What the line means; null for nothing typed. */
export function readField(text: string): FieldCommand | null {
  const line = text.trim();
  if (!line) return null;
  const screen = screenOf(line);
  if (screen) return { kind: "open", screen };
  const field = fieldOf(line);
  if (field) return { kind: "field", ident: field };
  const route = routeOf(line);
  if (route) return { kind: "route", ...route };
  const place = placeOf(line);
  if (place) {
    // "fly to kdlh": the place named is a field's ident, the route's end.
    const named = routeOf(place);
    return named ? { kind: "route", ...named } : { kind: "place", words: place };
  }
  return { kind: "ask", question: line };
}
