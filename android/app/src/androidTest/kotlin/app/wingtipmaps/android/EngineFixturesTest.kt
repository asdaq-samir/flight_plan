package app.wingtipmaps.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.wingtipmaps.android.engine.Engine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** Numbers as close as the Rust and web fixture tests hold them: they
 *  compare exactly, the wind triangle's to nine places (flight_rules.rs,
 *  flightRules.test.ts); a number that went through text and back is
 *  allowed that much. */
private const val TOLERANCE = 1e-9

/** The first place [got] is not [want], or null where they are the same
 *  JSON: the same keys (a null is not a key left out), the same order in a
 *  list, strings exactly, true and false as themselves and never 1 and 0. */
private fun difference(got: JsonElement?, want: JsonElement?, path: String = "$"): String? {
    val g = got ?: JsonNull
    val w = want ?: JsonNull
    return when {
        g is JsonNull || w is JsonNull -> if (g is JsonNull && w is JsonNull) null else "$path: $g is not $w"
        g is JsonObject && w is JsonObject ->
            if (g.keys != w.keys) {
                "$path: keys ${(g.keys - w.keys).sorted()} not wanted, ${(w.keys - g.keys).sorted()} missing"
            } else {
                w.keys.sorted().firstNotNullOfOrNull { difference(g[it], w[it], "$path.$it") }
            }
        g is JsonArray && w is JsonArray ->
            if (g.size != w.size) "$path: ${g.size} items, not ${w.size}"
            else g.indices.firstNotNullOfOrNull { difference(g[it], w[it], "$path[$it]") }
        g is JsonPrimitive && w is JsonPrimitive -> when {
            g.isString != w.isString -> "$path: $g and $w are not both strings"
            g.isString -> if (g.content == w.content) null else "$path: $g is not $w"
            (g.booleanOrNull != null) != (w.booleanOrNull != null) -> "$path: $g and $w are not both true or false"
            g.booleanOrNull != null -> if (g.booleanOrNull == w.booleanOrNull) null else "$path: $g is not $w"
            else -> {
                val a = g.doubleOrNull
                val b = w.doubleOrNull
                if (a != null && b != null && abs(a - b) <= TOLERANCE) null else "$path: $g is not $w"
            }
        }
        else -> "$path: $g is not $w"
    }
}

/**
 * The engine through this app's own bridge (Engine.callNative, the JNI
 * shim in wingtip_jni.c over wt_call) held to the shared fixtures the
 * engine's Rust tests (native/engine/tests) and the web's vitest tests
 * (through the .wasm) hold it to: web/src/lib/fixtures, this test APK's
 * assets by build.gradle.kts. The Rust and web tests never pass through
 * JNI, so a shim that changed a key's case, wrote a number as a string,
 * dropped a null or broke a character outside ASCII (JNI's strings are
 * modified UTF-8) would leave them green; here it fails. The answer is
 * compared as the JSON it is, before any of the app's classes decode it
 * (the iOS app's BridgeFixturesTests is the twin).
 *
 * Each fixture is asked by the rule names the phones call: read_atis,
 * checklist_read and checklist_write, read_clearance, cleared_route,
 * our_call, direct_of, hold_read, hold_write, holding_leg_minutes,
 * logbook_csv_read and logbook_csv_write, readback_check, traffic_marks.
 */
@RunWith(AndroidJUnit4::class)
class EngineFixturesTest {
    private val misses = mutableListOf<String>()

    private fun fixture(name: String): JsonObject =
        Json.parseToJsonElement(
            InstrumentationRegistry.getInstrumentation().context.assets.open(name).bufferedReader().use { it.readText() },
        ).jsonObject

    private fun JsonObject.cases(key: String): List<JsonObject> = getValue(key).jsonArray.map { it.jsonObject }

    /** The rule's answer through the bridge, parsed as JSON; a member
     *  given as null is written as JSON's null. */
    private fun ask(name: String, vararg input: Pair<String, JsonElement?>): JsonElement =
        Json.parseToJsonElement(Engine.callNative(name, JsonObject(input.associate { (k, v) -> k to (v ?: JsonNull) }).toString()))

    private fun check(got: JsonElement?, want: JsonElement?, what: String) {
        difference(got, want)?.let { misses += "$what: $it" }
    }

    /** Every difference at once, so one run shows them all. */
    private fun done() = assertTrue(misses.joinToString("\n"), misses.isEmpty())

    @Test
    fun anAtisReadsThroughTheBridgeAsInTheFixture() {
        val all = fixture("atis.json").cases("cases")
        assertTrue(all.size >= 12)
        for (c in all) check(ask("read_atis", "text" to c["heard"]), c["reading"], "${c["name"]}")
        done()
    }

    @Test
    fun aChecklistReadsAndWritesThroughTheBridge() {
        val all = fixture("checklist.json").cases("cases")
        assertTrue(all.isNotEmpty())
        all.forEachIndexed { i, c ->
            check(ask("checklist_read", "text" to c["text"]), c["checklist"], "case $i, read")
            check(ask("checklist_write", "checklist" to c["checklist"]), c["written"], "case $i, written")
        }
        done()
    }

    @Test
    fun aClearanceAndTheRouteItGivesReadThroughTheBridge() {
        val f = fixture("clearances.json")
        val read = f.cases("read")
        val routes = f.cases("routes")
        assertTrue(read.isNotEmpty() && routes.isNotEmpty())
        for (c in read) check(ask("read_clearance", "text" to c["heard"]), c["clearance"], "${c["heard"]}")
        for (c in routes) {
            val got = ask("cleared_route", "text" to c["heard"], "found" to c["found"], "planned" to c["planned"])
            check(got, JsonObject(mapOf("route" to c.getValue("route"), "typed" to c.getValue("typed"))), "${c["heard"]}")
        }
        done()
    }

    @Test
    fun aCallToUsIsHeardThroughTheBridge() {
        val f = fixture("heardCalls.json")
        val all = f.cases("cases")
        assertTrue(all.isNotEmpty())
        for (c in all) {
            val heard = "${c["heard"]}"
            check(ask("our_call", "text" to c["heard"], "tail" to f["tail"]), c["forUs"], "$heard, for us")
            check(ask("direct_of", "text" to c["heard"]), c["direct"], "$heard, direct")
            // The web's maintainFt is read from the whole clearance, where
            // one with none leaves it null.
            val clearance = ask("read_clearance", "text" to c["heard"]) as? JsonObject
            check(clearance?.get("maintainFt"), c["maintainFt"], "$heard, maintain")
        }
        done()
    }

    @Test
    fun aHoldReadsAndWritesThroughTheBridge() {
        val f = fixture("holds.json")
        val all = f.cases("parse")
        assertTrue(all.size >= 5)
        // The engine's hold is snake_case, the fixture's camelCase; a member
        // it leaves out is null, as route.rs compares them.
        val keys = listOf(
            "fix" to "fix", "inbound" to "inbound", "right" to "right", "leg_min" to "legMin",
            "leg_nm" to "legNm", "turns" to "turns", "minutes" to "minutes",
        )
        for (c in all) {
            val text = "${c["text"]}"
            val read = ask("hold_read", "text" to c["text"])
            val want = c["hold"] as? JsonObject
            if (want == null) {
                check(read, JsonNull, "$text read")
                continue
            }
            if (read !is JsonObject) {
                misses += "$text: read as $read, not a hold"
                continue
            }
            for ((ours, theirs) in keys) check(read[ours], want[theirs], "$text read, $ours")
            check(ask("hold_write", "hold" to read), c["written"], "$text written")
        }
        for (c in f.cases("legMinutes")) {
            check(ask("holding_leg_minutes", "altitude_ft" to c["altitudeFt"]), c["minutes"], "legs at ${c["altitudeFt"]} ft")
        }
        done()
    }

    @Test
    fun theLogbookIsWrittenAndReadThroughTheBridge() {
        val f = fixture("logbookCsv.json")
        val exports = f.cases("export")
        val imports = f.cases("import")
        assertTrue(exports.isNotEmpty() && imports.isNotEmpty())
        exports.forEachIndexed { i, c ->
            check(ask("logbook_csv_write", "entries" to c["entries"]), c["csv"], "written out, case $i")
        }
        for (c in imports) {
            val want = JsonObject(mapOf("entries" to c.getValue("entries"), "skipped" to c.getValue("skipped")))
            check(ask("logbook_csv_read", "text" to c["text"]), want, "${c["name"]}")
        }
        done()
    }

    @Test
    fun aReadbackIsCheckedThroughTheBridge() {
        val f = fixture("readbacks.json")
        val all = f.cases("cases")
        assertTrue(all.isNotEmpty())
        for (c in all) {
            val got = ask("readback_check", "cleared" to f["cleared"], "said" to c["said"]) as? JsonObject
            check(got?.get("items"), c["items"], "${c["name"]}, items")
            check(got?.get("words"), c["words"], "${c["name"]}, words")
        }
        val level = f.getValue("flightLevel").jsonObject
        for (c in level.cases("cases")) {
            val got = ask("readback_check", "cleared" to level["cleared"], "said" to c["said"]) as? JsonObject
            check(got?.get("items"), c["items"], "${c["said"]}, items")
        }
        done()
    }

    @Test
    fun trafficIsMarkedThroughTheBridge() {
        val all = fixture("traffic.json").cases("cases")
        assertTrue(all.size >= 20)
        for (c in all) {
            val got = ask("traffic_marks", "own_ft" to c["ownFt"], "planes" to JsonArray(listOf(c.getValue("plane"))))
            val want = JsonArray(listOf(JsonObject(mapOf("label" to c.getValue("label"), "near" to c.getValue("near")))))
            check(got, want, "${c["plane"]} against ${c["ownFt"]}")
        }
        done()
    }
}
