package app.wingtipmaps.android.records

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/**
 * The pilot's own records on the device -- the airplanes kept as
 * Favorites and Recents, the watches set on them, the routes planned --
 * in one Room database, the twin of the iOS app's SwiftData store
 * (Records.swift, PlannedRoute.swift). Phase 0 kept no records (its
 * SharedPreferences hold the last plan and the cookie jar, neither a
 * record), so there is nothing to take in.
 *
 * iOS carries its store to the pilot's other devices through iCloud.
 * Android has no equivalent of CloudKit for an app's own store, so the
 * gateway is the sync path for a signed-in pilot: the favourites,
 * watches and planned routes a pilot wants on both phones go up to the
 * gateway and come back on the other, once it has endpoints for them.
 * `Records.sync` is the hook: a Sync set there is told of every change,
 * and nothing here waits on it.
 */
object Records {
    /** Where a change goes beyond the device: the gateway, for a
     *  signed-in pilot, once it keeps these. Null until then. */
    interface Sync {
        suspend fun changed(what: String)
    }

    @Volatile
    var sync: Sync? = null

    @Volatile
    private var shared: RecordsDatabase? = null

    /** The one database, in the app's files; a change the schema cannot
     *  migrate starts it afresh, since every record is also the
     *  gateway's or soon set again, and the app must always start. */
    fun database(context: Context): RecordsDatabase =
        shared ?: synchronized(this) {
            shared ?: Room.databaseBuilder(context.applicationContext, RecordsDatabase::class.java, "records.db")
                .fallbackToDestructiveMigration(dropAllTables = true)
                .build()
                .also { shared = it }
        }

    /** A database that lives only as long as the test that made it. */
    fun inMemory(context: Context): RecordsDatabase =
        Room.inMemoryDatabaseBuilder(context, RecordsDatabase::class.java).build()
}

/** An airplane the pilot kept (the web app's favoriteAircraft and
 *  recentAircraft): one row per ICAO address, flagged with the lists it
 *  is in, so a favourite that is also recent is one row and a Favorites
 *  toggle does not touch the Recents. `addedAt` orders the Favorites as
 *  they were added; `recentAt` the Recents, newest first. Times are ms
 *  since 1970, as a store carries numbers. */
@Entity(tableName = "kept_airplanes")
data class KeptAirplane(
    @PrimaryKey val hex: String,
    val name: String,
    val type: String? = null,
    val favorite: Boolean = false,
    val recent: Boolean = false,
    val addedAt: Long,
    val recentAt: Long? = null,
)

/** What a pilot asked to be told of an airplane, from its card (the web
 *  app's lib/aircraftAlerts): that it takes off, or that it lands. Said
 *  once, aloud and over the map, then let go, as FlightAware's are. One
 *  row per airplane and kind. */
@Entity(tableName = "watches", primaryKeys = ["hex", "kind"])
data class AirplaneWatch(
    val hex: String,
    val name: String,
    /** "takeoff" or "land" (WatchKind); a store carries words. */
    val kind: String,
    val setAt: Long,
)

/** The watch's one name, for the notification that replaces an earlier
 *  one of the same thing. Outside the entity, so Room sees columns only. */
val AirplaneWatch.id: String get() = "$hex:$kind"

enum class WatchKind(val word: String) {
    TAKEOFF("takeoff"), LAND("land");

    companion object {
        /** Null for a kind a newer build wrote that this one does not know. */
        fun of(word: String): WatchKind? = entries.firstOrNull { it.word == word }
    }
}

/** A route the pilot planned, as the route box held it: the points, the
 *  altitude, when. The stops are one line of idents, as the web app's
 *  route address writes them. */
@Entity(tableName = "planned_routes")
data class PlannedRoute(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val dep: String,
    val dest: String,
    val stopsLine: String,
    val altitudeFt: Double? = null,
    val altitudeChoice: String? = null,
    val plannedAt: Long,
)

/** The stops as idents again. Outside the entity, so Room sees columns only. */
val PlannedRoute.stops: List<String> get() = stopsLine.split(" ").filter { it.isNotEmpty() }

@Dao
interface RecordsDao {
    @Query("SELECT * FROM kept_airplanes ORDER BY addedAt")
    fun keptAirplanes(): Flow<List<KeptAirplane>>

    @Query("SELECT * FROM kept_airplanes WHERE hex = :hex")
    suspend fun keptAirplane(hex: String): KeptAirplane?

    @Query("SELECT * FROM kept_airplanes WHERE recent ORDER BY recentAt DESC")
    suspend fun recents(): List<KeptAirplane>

    @Query("SELECT * FROM kept_airplanes WHERE favorite")
    suspend fun favorites(): List<KeptAirplane>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putAirplane(airplane: KeptAirplane)

    @Query("DELETE FROM kept_airplanes WHERE hex = :hex")
    suspend fun forgetAirplane(hex: String)

    @Query("SELECT * FROM watches ORDER BY setAt")
    fun watches(): Flow<List<AirplaneWatch>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putWatch(watch: AirplaneWatch)

    @Query("DELETE FROM watches WHERE hex = :hex AND kind = :kind")
    suspend fun removeWatch(hex: String, kind: String)

    @Query("SELECT * FROM planned_routes ORDER BY plannedAt DESC")
    suspend fun plannedRoutes(): List<PlannedRoute>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putRoute(route: PlannedRoute)

    @Query("DELETE FROM planned_routes WHERE id = :id")
    suspend fun removeRoute(id: Long)

    @Query("DELETE FROM kept_airplanes")
    suspend fun eraseAirplanes()

    @Query("DELETE FROM watches")
    suspend fun eraseWatches()

    @Query("DELETE FROM planned_routes")
    suspend fun eraseRoutes()
}

@Database(entities = [KeptAirplane::class, AirplaneWatch::class, PlannedRoute::class], version = 1, exportSchema = false)
abstract class RecordsDatabase : RoomDatabase() {
    abstract fun dao(): RecordsDao

    /** Everything the store holds, gone: the account deleted. */
    suspend fun erase() {
        dao().eraseAirplanes()
        dao().eraseWatches()
        dao().eraseRoutes()
        Records.sync?.changed("erased")
    }
}

/** The rules of the lists, as plain functions of the rows, so the
 *  Tracking model and the route keeper hold them in one place and a JVM
 *  test holds them without a database: Recents are a dozen, newest
 *  first; a row in neither list is no row; a route planned again moves
 *  to the top rather than repeat, and the list stays at its limit. */
object Keeping {
    /** Recents kept, newest first (the web app's and iOS's dozen). */
    const val RECENTS = 12
    /** Planned routes kept (the iOS app's PlanHistory.limit). */
    const val ROUTES = 50

    /** The Favorites in the order added. */
    fun favorites(rows: List<KeptAirplane>): List<KeptAirplane> = rows.filter { it.favorite }.sortedBy { it.addedAt }

    /** The Recents, newest first. */
    fun recents(rows: List<KeptAirplane>): List<KeptAirplane> =
        rows.filter { it.recent }.sortedByDescending { it.recentAt ?: Long.MIN_VALUE }

    /** An airplane remembered now: its row with the recent flag and the
     *  time, and the rows of the Recents beyond a dozen as they become
     *  (the flag off; null where the row is then in no list and goes). */
    fun remembered(rows: List<KeptAirplane>, hex: String, name: String, type: String?, nowMs: Long): List<Pair<KeptAirplane, KeptAirplane?>> {
        val had = rows.firstOrNull { it.hex == hex }
        val row = (had ?: KeptAirplane(hex = hex, name = name, addedAt = nowMs))
            .copy(name = name, type = type ?: had?.type, recent = true, recentAt = nowMs)
        val changes = mutableListOf<Pair<KeptAirplane, KeptAirplane?>>(row to row)
        val recent = recents(rows.filter { it.hex != hex } + row)
        for (old in recent.drop(RECENTS)) {
            val after = old.copy(recent = false)
            changes += old to (if (after.favorite) after else null)
        }
        return changes
    }

    /** A row with a flag turned off: the row as it becomes, or null where
     *  it is then in no list and goes. */
    fun pruned(row: KeptAirplane): KeptAirplane? = if (row.favorite || row.recent) row else null

    /** A route planned: the rows as they become -- the same route and
     *  altitude moved to the top with the new time, else a new row -- and
     *  the ids of the rows beyond the limit, which go. */
    fun planned(rows: List<PlannedRoute>, dep: String, dest: String, stops: List<String>, altitudeFt: Double?, altitudeChoice: String?, atMs: Long): Pair<PlannedRoute, List<Long>> {
        val stopsLine = stops.joinToString(" ")
        val same = rows.firstOrNull { it.dep == dep && it.dest == dest && it.stopsLine == stopsLine && it.altitudeFt == altitudeFt }
        val row = same?.copy(plannedAt = atMs, altitudeChoice = altitudeChoice)
            ?: PlannedRoute(dep = dep, dest = dest, stopsLine = stopsLine, altitudeFt = altitudeFt, altitudeChoice = altitudeChoice, plannedAt = atMs)
        val kept = (rows.filter { it.id != same?.id } + row).sortedByDescending { it.plannedAt }
        val gone = kept.drop(ROUTES).map { it.id }.filter { it != 0L }
        return row to gone
    }
}

/** A route planned, kept (the iOS app's PlanHistory.planned): the same
 *  points and altitude planned again move to the top with the new time
 *  rather than repeat, and the list stays at its limit. */
suspend fun RecordsDao.planned(dep: String, dest: String, stops: List<String>, altitudeFt: Double?, altitudeChoice: String?, atMs: Long = System.currentTimeMillis()) {
    if (dep.isEmpty() && dest.isEmpty() && stops.isEmpty()) return
    val (row, gone) = Keeping.planned(plannedRoutes(), dep, dest, stops, altitudeFt, altitudeChoice, atMs)
    putRoute(row)
    for (id in gone) removeRoute(id)
    Records.sync?.changed("routes")
}
