package app.wingtipmaps.android.map

import android.content.ComponentCallbacks
import android.content.res.Configuration
import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.wingtipmaps.android.api.PathPoint
import app.wingtipmaps.android.flight.OwnShip
import app.wingtipmaps.android.tiles.TileTemplate
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource

/**
 * The FAA chart on a map that works like Maps on a phone: MapLibre's
 * native map view with one raster source over the chart's tiles
 * (TileTemplate) and the route's line over that. MapLibre is the open
 * native map -- no key, no account, no usage terms of a maps vendor's --
 * which is why it draws the chart rather than Google Maps
 * (docs/NATIVE-ANDROID.md). The view is Android's own, so its lifecycle
 * is forwarded from the composition's.
 *
 * @param line the route's great-circle line as pairs of latitude and
 *   longitude (Course.courseLine); empty for none.
 * @param ownShip the airplane's fix (OwnShip), drawn as the blue dot;
 *   null for none, or own ship off.
 * @param trail the path flown (OwnTrail), drawn under the route.
 * @param follow whether the map keeps the airplane in the middle; a
 *   drag of the map ends it (`onDragged`), as Apple Maps lets go.
 */
@Composable
fun ChartMap(
    template: TileTemplate?,
    minZoom: Int,
    maxZoom: Int,
    line: List<List<Double>>,
    modifier: Modifier = Modifier,
    ownShip: OwnShip.Fix? = null,
    trail: List<PathPoint> = emptyList(),
    follow: Boolean = false,
    onDragged: () -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val holder = remember { MapHolder(MapView(context)) }
    holder.onDragged = onDragged

    DisposableEffect(lifecycle, holder) {
        val observer = LifecycleEventObserver { _, event -> holder.on(event) }
        lifecycle.addObserver(observer)
        // The system's low-memory call, which the map view answers by
        // dropping what it can; a lifecycle has no event for it.
        val memory = object : ComponentCallbacks {
            override fun onConfigurationChanged(newConfig: Configuration) {}
            override fun onLowMemory() = holder.view.onLowMemory()
        }
        val app = context.applicationContext
        app.registerComponentCallbacks(memory)
        onDispose {
            lifecycle.removeObserver(observer)
            app.unregisterComponentCallbacks(memory)
            holder.destroy()
        }
    }

    LaunchedEffect(holder, template, minZoom, maxZoom) { holder.style(template, minZoom, maxZoom, line) }
    LaunchedEffect(holder, line) { holder.route(line) }
    LaunchedEffect(holder, ownShip, follow) { holder.ownShip(ownShip, follow) }
    LaunchedEffect(holder, trail) { holder.trail(trail) }

    AndroidView(factory = { holder.view }, modifier = modifier)
}

/** The map view with its lifecycle forwarded, each call made at most
 *  once however the composition and the activity end. */
private class MapHolder(val view: MapView) {
    private var created = false
    private var destroyed = false
    private var opened = false
    /** Told when the pilot drags the map, so following ends. */
    var onDragged: () -> Unit = {}
    /** What the map last drew of the airplane and its path, drawn again
     *  when the chart's style is set anew (a cycle change), which drops
     *  every source but the chart's. */
    private var lastFix: OwnShip.Fix? = null
    private var lastFollow = false
    private var lastTrail: List<PathPoint> = emptyList()

    fun on(event: Lifecycle.Event) {
        if (destroyed) return
        when (event) {
            Lifecycle.Event.ON_CREATE -> if (!created) {
                created = true
                view.onCreate(null)
            }
            Lifecycle.Event.ON_START -> view.onStart()
            Lifecycle.Event.ON_RESUME -> view.onResume()
            Lifecycle.Event.ON_PAUSE -> view.onPause()
            Lifecycle.Event.ON_STOP -> view.onStop()
            Lifecycle.Event.ON_DESTROY -> destroy()
            else -> {}
        }
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        if (created) view.onDestroy()
    }

    /** The chart as the map's style: the one raster source and its
     *  layer, then the route on top once the style is in. */
    fun style(template: TileTemplate?, minZoom: Int, maxZoom: Int, line: List<List<Double>>) {
        if (destroyed) return
        view.getMapAsync { map ->
            open(map)
            if (template == null) return@getMapAsync
            map.setStyle(Style.Builder().fromJson(styleJson(template, minZoom, maxZoom))) { style ->
                route(style, line)
                trail(style, lastTrail)
                ownShip(map, style, lastFix, lastFollow)
            }
        }
    }

    fun route(line: List<List<Double>>) {
        if (destroyed) return
        view.getMapAsync { map -> map.getStyle { style -> route(style, line) } }
    }

    fun ownShip(fix: OwnShip.Fix?, follow: Boolean) {
        lastFix = fix
        lastFollow = follow
        if (destroyed) return
        view.getMapAsync { map -> map.getStyle { style -> ownShip(map, style, fix, follow) } }
    }

    fun trail(points: List<PathPoint>) {
        lastTrail = points
        if (destroyed) return
        view.getMapAsync { map -> map.getStyle { style -> trail(style, points) } }
    }

    /** Fresh open over the Chicago area, as the web app opens until a
     *  position comes (lib/map); the first fix followed brings the map
     *  to the airplane. A drag by the pilot ends following, as Apple
     *  Maps lets go of the position when the map is moved by hand. */
    private fun open(map: MapLibreMap) {
        if (opened) return
        opened = true
        map.cameraPosition = CameraPosition.Builder().target(LatLng(41.9, -87.9)).zoom(8.0).build()
        map.addOnCameraMoveStartedListener { reason ->
            if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) onDragged()
        }
    }

    /** The airplane as the blue dot of a map app (the web app's own-ship
     *  mark), white-edged so it reads on the chart's every colour; the
     *  map brought to it while following, at the sectional's scale the
     *  first time and then only moved, so a pinch the pilot made is kept. */
    private fun ownShip(map: MapLibreMap, style: Style, fix: OwnShip.Fix?, follow: Boolean) {
        val geoJson = pointJson(fix)
        val source = style.getSourceAs<GeoJsonSource>(OWN_SHIP)
        if (source != null) {
            source.setGeoJson(geoJson)
        } else {
            style.addSource(GeoJsonSource(OWN_SHIP, geoJson))
            style.addLayer(
                CircleLayer(OWN_SHIP, OWN_SHIP).withProperties(
                    PropertyFactory.circleRadius(7f),
                    PropertyFactory.circleColor(Color.rgb(0, 122, 255)),
                    PropertyFactory.circleStrokeColor(Color.WHITE),
                    PropertyFactory.circleStrokeWidth(2.5f),
                ),
            )
        }
        if (follow && fix != null) {
            val at = LatLng(fix.lat, fix.lon)
            val update = if (map.cameraPosition.zoom < FOLLOW_ZOOM) CameraUpdateFactory.newLatLngZoom(at, FOLLOW_ZOOM)
            else CameraUpdateFactory.newLatLng(at)
            map.animateCamera(update, FOLLOW_MS)
        }
    }

    /** The path flown, under the route: a thinner line in the route's
     *  colour, so where the airplane went reads against where it meant
     *  to go. */
    private fun trail(style: Style, points: List<PathPoint>) {
        val geoJson = lineJson(points.map { it.lat to it.lon })
        val source = style.getSourceAs<GeoJsonSource>(TRAIL)
        if (source != null) {
            source.setGeoJson(geoJson)
            return
        }
        style.addSource(GeoJsonSource(TRAIL, geoJson))
        val layer = LineLayer(TRAIL, TRAIL).withProperties(
            PropertyFactory.lineColor(Color.rgb(0, 122, 255)),
            PropertyFactory.lineWidth(2.5f),
            PropertyFactory.lineOpacity(0.6f),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        )
        if (style.getLayer(ROUTE) != null) style.addLayerBelow(layer, ROUTE) else style.addLayer(layer)
    }

    private fun route(style: Style, line: List<List<Double>>) {
        val geoJson = lineJson(line.filter { it.size == 2 }.map { it[0] to it[1] })
        val source = style.getSourceAs<GeoJsonSource>(ROUTE)
        if (source != null) {
            source.setGeoJson(geoJson)
            return
        }
        style.addSource(GeoJsonSource(ROUTE, geoJson))
        // The route line as the web app draws it: the blue tint, a little
        // see-through so the chart reads under it.
        style.addLayer(
            LineLayer(ROUTE, ROUTE).withProperties(
                PropertyFactory.lineColor(Color.rgb(0, 122, 255)),
                PropertyFactory.lineWidth(4f),
                PropertyFactory.lineOpacity(0.8f),
                PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
                PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
            ),
        )
    }

    private companion object {
        const val CHART = "chart"
        const val ROUTE = "route"
        const val OWN_SHIP = "own-ship"
        const val TRAIL = "trail"
        /** The sectional's own scale, where the airplane's surroundings
         *  read: the web app's zoom on a position (lib/map). */
        const val FOLLOW_ZOOM = 9.0
        /** Shorter than a fix's second, so the dot never lags the map. */
        const val FOLLOW_MS = 300

        /** An empty style but for the chart: no vendor's base map under
         *  it, as the FAA's chart is the whole picture. */
        fun styleJson(template: TileTemplate, minZoom: Int, maxZoom: Int): String = buildJsonObject {
            put("version", 8)
            putJsonObject("sources") {
                putJsonObject(CHART) {
                    put("type", "raster")
                    putJsonArray("tiles") { add(template.pattern()) }
                    put("tileSize", 256)
                    put("minzoom", minZoom)
                    put("maxzoom", maxZoom)
                }
            }
            putJsonArray("layers") {
                addJsonObject {
                    put("id", CHART)
                    put("type", "raster")
                    put("source", CHART)
                }
            }
        }.toString()

        /** A line (the route, the path flown) as GeoJSON, whose
         *  coordinates are longitude first; no feature under two points. */
        fun lineJson(points: List<Pair<Double, Double>>): String = buildJsonObject {
            put("type", "FeatureCollection")
            putJsonArray("features") {
                if (points.size >= 2) {
                    addJsonObject {
                        put("type", "Feature")
                        putJsonObject("properties") {}
                        putJsonObject("geometry") {
                            put("type", "LineString")
                            putJsonArray("coordinates") {
                                for ((lat, lon) in points) addJsonArray {
                                    add(lon)
                                    add(lat)
                                }
                            }
                        }
                    }
                }
            }
        }.toString()

        /** The airplane as GeoJSON: one point, or none. */
        fun pointJson(fix: OwnShip.Fix?): String = buildJsonObject {
            put("type", "FeatureCollection")
            putJsonArray("features") {
                if (fix != null) {
                    addJsonObject {
                        put("type", "Feature")
                        putJsonObject("properties") {}
                        putJsonObject("geometry") {
                            put("type", "Point")
                            putJsonArray("coordinates") {
                                add(fix.lon)
                                add(fix.lat)
                            }
                        }
                    }
                }
            }
        }.toString()
    }
}
