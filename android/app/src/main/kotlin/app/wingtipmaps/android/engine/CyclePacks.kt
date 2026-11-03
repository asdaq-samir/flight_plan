package app.wingtipmaps.android.engine

import android.content.Context
import app.wingtipmaps.android.api.Ahead
import app.wingtipmaps.android.api.AirspaceAt
import app.wingtipmaps.android.api.CyclePackIndex
import app.wingtipmaps.android.api.Gateway
import app.wingtipmaps.android.api.Planner
import app.wingtipmaps.android.api.await
import app.wingtipmaps.android.flight.Geo
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString

/**
 * The cycle packs kept on the phone, a region each (vfr.pack's
 * write_phone), so the airspace over a point, what is ahead and the
 * map's fields are answered with no connection: kept along a route with
 * its chart, and fetched again for the regions kept when the FAA's cycle
 * turns. The twin of the iOS app's CyclePacks.swift. Under filesDir, not
 * cacheDir: Android may clear the cache when space is short, as it may
 * the chart's tiles, and the packs are small. Each pack is memory-mapped
 * once and handed to the engine's readers (Packs) as a direct buffer,
 * never copied.
 */
class CyclePacks(private val root: File) {
    private val indexFile = File(root, "index.json")
    private val lock = Any()
    /** The packs mapped so far, by file: a map is one syscall and the
     *  pages come in as the engine reads them, and the same pack is asked
     *  about every second in flight. Let go when the cycle turns. */
    private val mapped = HashMap<String, ByteBuffer>()

    /** The list the packs on the phone were fetched by; null before the
     *  first keep. */
    val index: CyclePackIndex?
        get() = runCatching { Gateway.json.decodeFromString<CyclePackIndex>(indexFile.readText()) }.getOrNull()

    fun path(cycle: String, region: String): File = File(root, "$cycle/$region.pack")

    /** One pack mapped read-only, or null where the phone has not got it. */
    fun pack(cycle: String, region: String): ByteBuffer? {
        val file = path(cycle, region)
        synchronized(lock) {
            mapped[file.path]?.let { return it }
            if (!file.isFile) return null
            val buffer = runCatching {
                RandomAccessFile(file, "r").use { it.channel.map(FileChannel.MapMode.READ_ONLY, 0, it.length()) }
            }.getOrNull() ?: return null
            mapped[file.path] = buffer
            return buffer
        }
    }

    /** The packs of these regions of the kept cycle, those the phone has. */
    fun packs(regions: Collection<String>): Array<ByteBuffer> {
        val index = index ?: return emptyArray()
        return regions.sorted().mapNotNull { pack(index.cycle, it) }.toTypedArray()
    }

    /** The packs of these regions fetched where the phone has not got them
     *  for the planner's cycle, and the regions already kept fetched again
     *  where the cycle has turned; an older cycle's removed. Quiet where
     *  the planner cannot be reached: the next keep tries again. */
    suspend fun keep(wanted: Set<String>) {
        val listing = try {
            Planner.fetch("/api/cycle-packs")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return
        }
        val fresh = runCatching { Gateway.json.decodeFromString<CyclePackIndex>(listing) }.getOrNull() ?: return
        val kept = index
        val names = wanted.toMutableSet()
        if (kept != null && kept.cycle != fresh.cycle) names += keptRegions(kept.cycle)
        val listed = fresh.regions.associateBy { it.name }
        withContext(Dispatchers.IO) {
            File(root, fresh.cycle).mkdirs()
            for (name in names.sorted()) {
                if (name !in listed) continue
                val file = path(fresh.cycle, name)
                if (file.isFile) continue
                val bytes = fetchPack(fresh.cycle, name) ?: continue
                // Verified before it is kept: a pack cut short by the
                // connection is no pack, and the engine would say so on
                // every read.
                val direct = ByteBuffer.allocateDirect(bytes.size).put(bytes)
                // As a Buffer: ByteBuffer's own flip() only exists from
                // API 34, and the engine wants a direct buffer, not the array.
                (direct as java.nio.Buffer).flip()
                if (Packs.verify(direct) != 1) continue
                val part = File(file.path + ".part")
                part.writeBytes(bytes)
                if (!part.renameTo(file)) part.delete()
            }
            synchronized(lock) {
                indexFile.writeText(listing)
                root.listFiles()?.filter { it.isDirectory && it.name != fresh.cycle }?.forEach { it.deleteRecursively() }
                if (kept?.cycle != fresh.cycle) mapped.clear()
            }
        }
    }

    /** The packs kept again for a new cycle where the phone has any. */
    suspend fun refresh() {
        val kept = index ?: return
        if (keptRegions(kept.cycle).isEmpty()) return
        keep(emptySet())
    }

    private suspend fun fetchPack(cycle: String, region: String): ByteArray? {
        val request = Planner.get("/api/cycle-pack/$cycle/$region.pack")
        return runCatching {
            Gateway.client.newCall(request).await().use { response ->
                if (response.code != 200) null else response.body?.bytes()
            }
        }.getOrNull()
    }

    private fun keptRegions(cycle: String): Set<String> =
        File(root, cycle).listFiles()?.filter { it.extension == "pack" }?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()

    /** Every pack the phone keeps of the cycle, mapped: the regions its
     *  routes cross, for a clearance's places to be found in the air. */
    fun keptPacks(): Array<ByteBuffer> {
        val index = index ?: return emptyArray()
        return packs(keptRegions(index.cycle))
    }

    /** The airspace over a point from the packs on the phone; null where
     *  its region's pack was never kept. A region the list has no pack of
     *  has nothing drawn in it, and is answered by the rules alone. */
    fun airspaceAt(lat: Double, lon: Double, groundFt: Double? = null): AirspaceAt? {
        val index = index ?: return null
        val region = Engine.regionOf(lat, lon)
        val pack = if (index.regions.none { it.name == region }) null else pack(index.cycle, region) ?: return null
        val json = Packs.airspaceAt(pack, lat, lon, groundFt ?: Double.NaN) ?: return null
        return runCatching { Gateway.json.decodeFromString<AirspaceAt>(json) }.getOrNull()
    }

    /** The alerts ahead with no network (wt_ahead): what the planner's
     *  /api/airspace/ahead answers, worked out on the phone from the packs
     *  round the airplane. Null where no pack round the point was ever
     *  kept. The obstacles are the planner's alone and the TFRs are not
     *  kept on the phone yet: both are said to be missing, never clear. */
    fun ahead(lat: Double, lon: Double, trackDeg: Double, groundspeedKt: Double, altitudeFt: Double?, nowMs: Long = System.currentTimeMillis()): Ahead? {
        // The regions within a third of a degree: five minutes' track at
        // 200 kt is 17 nm, a quarter of a degree.
        val names = HashSet<String>()
        for (dlat in listOf(-0.3, 0.0, 0.3)) {
            for (dlon in listOf(-0.3, 0.0, 0.3)) names += Engine.regionOf(lat + dlat, lon + dlon)
        }
        val packs = packs(names)
        if (packs.isEmpty()) return null
        val json = Packs.ahead(packs, lat, lon, trackDeg, groundspeedKt, altitudeFt ?: Double.NaN, 0.0, nowMs / 1000, null, Long.MIN_VALUE)
            ?: return null
        return runCatching { Gateway.json.decodeFromString<Ahead>(json) }.getOrNull()
    }

    companion object {
        @Volatile
        private var shared: CyclePacks? = null

        /** The app's one store of packs, under filesDir/cycle-packs. */
        fun of(context: Context): CyclePacks =
            shared ?: synchronized(this) {
                shared ?: CyclePacks(File(context.applicationContext.filesDir, "cycle-packs")).also { shared = it }
            }

        /** The regions a route's corridor crosses: the region of each point
         *  along it, two nm apart, and of points a tenth of a degree (6 nm)
         *  either side, as its chart is kept five nm either side. The line
         *  is pairs of latitude and longitude, as /api/course gives it. */
        fun regions(line: List<List<Double>>): Set<String> {
            val names = HashSet<String>()
            for ((lat, lon) in samples(line, everyNm = 2.0)) {
                for (dlat in listOf(-0.1, 0.0, 0.1)) {
                    for (dlon in listOf(-0.1, 0.0, 0.1)) names += Engine.regionOf(lat + dlat, lon + dlon)
                }
            }
            return names
        }

        /** Points along a line every so many nm, with both its ends: the
         *  course line's legs are short enough that a straight cut between
         *  two of its points is within a tenth of a mile of the circle. */
        fun samples(line: List<List<Double>>, everyNm: Double): List<Pair<Double, Double>> {
            val out = ArrayList<Pair<Double, Double>>()
            for (i in line.indices) {
                val (lat, lon) = line[i][0] to line[i][1]
                if (i > 0) {
                    val (lat0, lon0) = line[i - 1][0] to line[i - 1][1]
                    val nm = Geo.nm(lat0, lon0, lat, lon)
                    val steps = (nm / everyNm).toInt()
                    for (s in 1 until steps) {
                        val f = s / steps.toDouble()
                        out += (lat0 + (lat - lat0) * f) to (lon0 + (lon - lon0) * f)
                    }
                }
                out += lat to lon
            }
            return out
        }
    }
}
