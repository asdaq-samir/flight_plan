package app.wingtipmaps.android.strip

/**
 * What a line typed or said into the one field means (OneField): a route
 * of idents, a place by name, one of the app's screens by its word, a
 * field's card, or a question for the assistant. The web app's
 * fieldCommands.ts word for word (web/src/features/strip), so the same
 * line means the same thing on every phone; pure, so the rules are held
 * to the web's own cases on the JVM (FieldCommandsTest). The doing is
 * StripModel's.
 *
 * The order matters: a screen's word first ("brief", "my airplane"), so
 * "brief me" opens the Brief rather than asking about a field called
 * BRIEF; then a field's card by its ident; then idents alone, which are a
 * route; then a short name with no question in it, which is a place to
 * fly to; everything else is asked.
 */

/** The screens the field opens by their word, in the web app's names. */
enum class FieldScreen {
    AIRPLANE, LOGBOOK, SETTINGS, INSTRUCTOR, BRIEF, NEAREST, FUEL, FOOD, STOPS,
    ROUTES, ALTITUDE, PROCEDURES, NAVLOG, PROFILE, SHARE, FILE, CLEARANCE, DRYRUN,
    SAVED, FAVORITES, RECENTS, RECENT_ROUTES, RADIO, MAP,
}

sealed interface FieldCommand {
    /** Idents alone: one is the destination, from the route's departure or
     *  where the airplane is; two are the ends; more are the ends and the
     *  stops between. */
    data class Route(val dep: String?, val stops: List<String>, val dest: String) : FieldCommand

    /** A place by name ("Duluth", "to Las Vegas"), for the places search
     *  and the biggest field by it. */
    data class Place(val words: String) : FieldCommand

    data class Open(val screen: FieldScreen) : FieldCommand

    /** A field's card, not a route to it: "about KDLH", "KDLH info". */
    data class Field(val ident: String) : FieldCommand

    data class Ask(val question: String) : FieldCommand
}

object FieldCommands {
    /** Each screen's words, whole, after the filler is taken off. */
    private val SCREEN_WORDS: Map<String, FieldScreen> = buildMap {
        fun words(screen: FieldScreen, vararg ws: String) = ws.forEach { put(it, screen) }
        words(FieldScreen.AIRPLANE, "airplane", "my airplane", "plane", "aircraft", "my aircraft", "airplanes", "weight and balance", "w&b", "checklist", "poh")
        words(FieldScreen.LOGBOOK, "logbook", "log book", "my logbook", "currency", "endorsements")
        words(FieldScreen.SETTINGS, "settings", "setup", "account", "sign in", "sign out", "training", "pilot guide", "guide", "mock oral", "passenger briefing")
        words(FieldScreen.INSTRUCTOR, "instructor", "my instructor")
        words(FieldScreen.BRIEF, "brief", "brief me", "briefing", "the brief", "go no go", "go/no-go")
        words(FieldScreen.NEAREST, "nearest", "nearest airport", "nearest airports", "nrst")
        words(FieldScreen.FUEL, "fuel", "nearest fuel", "gas", "avgas", "fuel stop", "fuel stops")
        words(FieldScreen.FOOD, "food", "nearest food", "eat", "lunch", "fly-in food")
        words(FieldScreen.STOPS, "stops", "stop", "rest stops", "where to stop")
        words(FieldScreen.ROUTES, "routes", "route options", "other routes", "ways")
        words(FieldScreen.ALTITUDE, "altitude", "altitudes", "cruise altitude")
        words(FieldScreen.PROCEDURES, "procedures", "procedure", "approaches", "approach", "plates", "pattern", "traffic pattern", "runways", "runway")
        words(FieldScreen.NAVLOG, "nav log", "navlog", "legs", "checkpoints", "the log")
        words(FieldScreen.PROFILE, "profile", "side view", "terrain")
        words(FieldScreen.SHARE, "share", "export", "print", "save", "send")
        words(FieldScreen.FILE, "file", "file it", "flight plan", "file flight plan", "file a flight plan")
        words(FieldScreen.CLEARANCE, "clearance", "read back", "readback")
        words(FieldScreen.DRYRUN, "dry run", "dryrun", "fly it on paper", "replay")
        words(FieldScreen.SAVED, "saved", "saved flights", "my flights", "flights")
        words(FieldScreen.FAVORITES, "favorites", "favourites", "home")
        words(FieldScreen.RECENTS, "recents", "recent", "recent airports")
        words(FieldScreen.RECENT_ROUTES, "recent routes", "routes planned", "last routes", "history")
        words(FieldScreen.RADIO, "radio", "listen", "atc")
        words(FieldScreen.MAP, "map", "map settings", "charts", "layers")
    }

    /** Words that only ask for a screen, taken off its front, the longer
     *  first so "show me" is not left as "me". */
    private val FILLER = Regex("""^(?:please\s+)?(?:let me see|show me|give me|take me to|go to|open|show|get|see|the|my)\s+""", RegexOption.IGNORE_CASE)

    /** A word that makes a line a question for the assistant, not a place. */
    private val QUESTION_WORDS = setOf(
        "what", "what's", "whats", "how", "how's", "is", "are", "am", "can", "could", "should", "will", "would", "do", "does", "did",
        "why", "when", "where", "which", "who", "if", "tell", "explain", "weather", "wind", "winds", "metar", "taf", "notam", "notams",
        "tfr", "tfrs", "ceiling", "visibility", "forecast", "minimums", "legal", "me", "i", "we", "my", "the", "about", "with",
    )

    /** The words between idents in a route, as typed or said: "to", "via",
     *  "from", "then", "and", an arrow or a comma. */
    private val ROUTE_JOINERS = setOf("to", "via", "from", "then", "and", "through", "stopping", "at", "->", "→", ">", "-")

    private val IDENT = Regex("""^[A-Z0-9]{3,4}$""")
    private val TRAILING_PUNCTUATION = Regex("""[.!?]+$""")
    private val TRAILING_STOP = Regex("""[.!]+$""")
    private val SEPARATORS = Regex("""[,→>]""")
    private val SPACES = Regex("""\s+""")
    private val TO_PLACE = Regex(
        """^(?:(?:please\s+)?(?:plan(?:\s+a)?(?:\s+trip|\s+route|\s+flight)?|fly|go|route|take me|direct|head|let's go|lets go)\s+)?to\s+(.+)$""",
        RegexOption.IGNORE_CASE,
    )
    private val FIELD_CARD = Regex(
        """^(?:(?:about|info(?: on)?|tell me about|what about)\s+(\S+)|(\S+)\s+(?:card|info|airport|field|details))$""",
        RegexOption.IGNORE_CASE,
    )

    /** A field's ident as the web's identOf reads one: three or four
     *  letters and digits, upper-cased; "" for anything else. */
    fun identOf(value: String?): String {
        val ident = (value ?: "").trim().uppercase()
        return if (IDENT.matches(ident)) ident else ""
    }

    private fun screenOf(text: String): FieldScreen? {
        var bare = text.lowercase().replace(TRAILING_PUNCTUATION, "").trim()
        var i = 0
        while (i < 3 && FILLER.containsMatchIn(bare)) {
            bare = bare.replaceFirst(FILLER, "").trim()
            i++
        }
        return SCREEN_WORDS[bare]
    }

    /** A word that is a field's ident as typed: three or four letters and
     *  digits with a digit in them (C81, 5Y8, 06C), four letters in any case
     *  (KDLH, kdlh), or three letters in capitals (ORD, DLH) -- typed small,
     *  three letters are a word ("fly", "see"), not a field. */
    private fun identTyped(word: String): String {
        val ident = identOf(word)
        if (ident.isEmpty()) return ""
        if (ident.any { it.isDigit() } || ident.length == 4) return ident
        return if (word == ident) ident else ""
    }

    /** Idents alone, in order, with the route's joiners between them; null
     *  where any word is not an ident. "KDLH from C81" is C81 to KDLH; the
     *  idents after "via" are stops wherever they are said ("C81 to KDLH via
     *  KJVL"), up to the next "to". */
    private fun routeOf(text: String): FieldCommand.Route? {
        val words = text.replace(SEPARATORS, " ").split(SPACES).filter { it.isNotEmpty() }
        if (words.isEmpty()) return null
        val idents = mutableListOf<String>()
        val via = mutableListOf<String>()
        var fromAt = -1
        var viaRun = false
        for (word in words) {
            val lower = word.lowercase()
            if (lower in ROUTE_JOINERS) {
                when (lower) {
                    "from" -> { fromAt = idents.size; viaRun = false }
                    "via", "through", "stopping" -> viaRun = true
                    "to" -> viaRun = false
                }
                continue
            }
            val ident = identTyped(word)
            if (ident.isEmpty()) return null
            (if (viaRun) via else idents).add(ident)
        }
        if (idents.isEmpty()) return null
        // "KDLH from C81": the ident after "from" is the departure.
        if (fromAt > 0 && fromAt < idents.size) {
            val dep = idents[fromAt]
            val rest = idents.subList(0, fromAt) + idents.subList(fromAt + 1, idents.size)
            return FieldCommand.Route(dep, rest.dropLast(1) + via, rest.last())
        }
        if (idents.size == 1) return FieldCommand.Route(null, via, idents[0])
        return FieldCommand.Route(idents.first(), idents.subList(1, idents.size - 1) + via, idents.last())
    }

    /** A place by name: "to Duluth", "fly to Las Vegas", "plan a trip to
     *  Madison", or a short name with no question in it. */
    private fun placeOf(text: String): String? {
        val bare = text.trim().replace(TRAILING_STOP, "")
        if ('?' in bare) return null
        TO_PLACE.find(bare)?.let { m -> return m.groupValues[1].trim().ifEmpty { null } }
        val words = bare.split(SPACES).filter { it.isNotEmpty() }
        if (words.isEmpty() || words.size > 3) return null
        if (words.any { it.lowercase() in QUESTION_WORDS }) return null
        return bare
    }

    /** A field's card asked for by its ident: "about KDLH", "info on C81",
     *  "KDLH card", "KDLH airport". */
    private fun fieldOf(text: String): String? {
        val m = FIELD_CARD.find(text.trim()) ?: return null
        val word = m.groupValues[1].ifEmpty { m.groupValues[2] }
        return identTyped(word).ifEmpty { null }
    }

    /** What the line means; null for nothing typed. */
    fun readField(text: String): FieldCommand? {
        val line = text.trim()
        if (line.isEmpty()) return null
        screenOf(line)?.let { return FieldCommand.Open(it) }
        fieldOf(line)?.let { return FieldCommand.Field(it) }
        routeOf(line)?.let { return it }
        placeOf(line)?.let { place ->
            // "fly to kdlh": the place named is a field's ident, the route's end.
            return routeOf(place) ?: FieldCommand.Place(place)
        }
        return FieldCommand.Ask(line)
    }
}
