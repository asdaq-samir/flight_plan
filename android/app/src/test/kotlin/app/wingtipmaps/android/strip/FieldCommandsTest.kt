package app.wingtipmaps.android.strip

import app.wingtipmaps.android.strip.FieldCommand.Ask
import app.wingtipmaps.android.strip.FieldCommand.Field
import app.wingtipmaps.android.strip.FieldCommand.Open
import app.wingtipmaps.android.strip.FieldCommand.Place
import app.wingtipmaps.android.strip.FieldCommand.Route
import app.wingtipmaps.android.strip.FieldCommands.readField
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What a line in the one field means (FieldCommands.readField): the web
 *  app's own cases (web/src/features/strip/fieldCommands.test.ts), so the
 *  same line means the same thing on every phone. */
class FieldCommandsTest {
    private fun route(dep: String?, dest: String, vararg stops: String) = Route(dep, stops.toList(), dest)

    @Test
    fun readsNothingFromAnEmptyLine() {
        assertNull(readField(""))
        assertNull(readField("   "))
    }

    @Test
    fun readsIdentsAsARouteOneTheDestinationTwoTheEndsMoreTheStopsBetween() {
        assertEquals(route(null, "KDLH"), readField("KDLH"))
        assertEquals(route(null, "KDLH"), readField("kdlh"))
        assertEquals(route("C81", "KDLH"), readField("C81 KDLH"))
        assertEquals(route("C81", "KDLH", "KJVL"), readField("C81 to KDLH via KJVL"))
        assertEquals(route("C81", "KDLH", "KJVL"), readField("C81 via KJVL to KDLH"))
        assertEquals(route(null, "KDLH", "KJVL"), readField("KDLH via KJVL"))
        assertEquals(route("C81", "KDLH", "KJVL"), readField("C81, KJVL, KDLH"))
        assertEquals(route("C81", "KDLH"), readField("C81 → KDLH"))
        assertEquals(route(null, "KDLH"), readField("to KDLH"))
        assertEquals(route(null, "KDLH"), readField("fly to kdlh"))
        assertEquals(route("C81", "KDLH"), readField("KDLH from C81"))
    }

    @Test
    fun takesThreeSmallLettersAsAWordNotAFieldAndThreeCapitalsAsAField() {
        assertEquals(route(null, "ORD"), readField("ORD"))
        assertEquals(Place("ord"), readField("ord"))
        assertEquals(Place("fly"), readField("fly"))
    }

    @Test
    fun opensAScreenByItsWordWithTheFillerTakenOff() {
        assertEquals(Open(FieldScreen.BRIEF), readField("Brief me"))
        assertEquals(Open(FieldScreen.BRIEF), readField("brief"))
        assertEquals(Open(FieldScreen.AIRPLANE), readField("My airplane"))
        assertEquals(Open(FieldScreen.LOGBOOK), readField("open my logbook"))
        assertEquals(Open(FieldScreen.SETTINGS), readField("Settings"))
        assertEquals(Open(FieldScreen.SETTINGS), readField("setup"))
        assertEquals(Open(FieldScreen.INSTRUCTOR), readField("instructor"))
        assertEquals(Open(FieldScreen.FUEL), readField("Nearest fuel"))
        assertEquals(Open(FieldScreen.NEAREST), readField("nearest"))
        assertEquals(Open(FieldScreen.ROUTES), readField("show me the routes"))
        assertEquals(Open(FieldScreen.ALTITUDE), readField("Altitude"))
        assertEquals(Open(FieldScreen.PROCEDURES), readField("procedures"))
        assertEquals(Open(FieldScreen.NAVLOG), readField("Nav log"))
        assertEquals(Open(FieldScreen.FILE), readField("file flight plan"))
        assertEquals(Open(FieldScreen.CLEARANCE), readField("clearance"))
        assertEquals(Open(FieldScreen.DRYRUN), readField("dry run"))
        assertEquals(Open(FieldScreen.STOPS), readField("stops"))
    }

    @Test
    fun opensAFieldsCardByItsIdentNotARouteToIt() {
        assertEquals(Field("KDLH"), readField("about KDLH"))
        assertEquals(Field("KDLH"), readField("KDLH info"))
        assertEquals(Field("C81"), readField("C81 airport"))
        assertEquals(Open(FieldScreen.RECENT_ROUTES), readField("recent routes"))
    }

    @Test
    fun readsAShortNameWithNoQuestionInItAsAPlaceToFlyTo() {
        assertEquals(Place("Duluth"), readField("Duluth"))
        assertEquals(Place("Duluth"), readField("to Duluth"))
        assertEquals(Place("Las Vegas"), readField("Las Vegas"))
        assertEquals(Place("Las Vegas"), readField("plan a trip to Las Vegas"))
        assertEquals(Place("Madison"), readField("fly to Madison"))
        assertEquals(Place("Duluth"), readField("take me to Duluth"))
    }

    @Test
    fun asksTheAssistantEverythingElse() {
        assertEquals(Ask("Weather at KDLH"), readField("Weather at KDLH"))
        assertEquals(Ask("Can I make Duluth before dark?"), readField("Can I make Duluth before dark?"))
        assertEquals(Ask("Is the weather within my minimums"), readField("Is the weather within my minimums"))
        assertEquals(Ask("What if I leave an hour later?"), readField("What if I leave an hour later?"))
        assertEquals(Ask("winds aloft on the way to Duluth"), readField("winds aloft on the way to Duluth"))
    }
}
