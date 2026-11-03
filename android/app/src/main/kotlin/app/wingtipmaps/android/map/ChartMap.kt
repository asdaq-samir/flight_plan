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
import app.wingtipmaps.android.tiles.TileTemplate
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
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
 */
@Composable
fun ChartMap(
    template: TileTemplate?,
    minZoom: Int,
    maxZoom: Int,
    line: List<List<Double>>,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val holder = remember { MapHolder(MapView(context)) }

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

    AndroidView(factory = { holder.view }, modifier = modifier)
}

/** The map view with its lifecycle forwarded, each call made at most
 *  once however the composition and the activity end. */
private class MapHolder(val view: MapView) {
    private var created = false
    private var destroyed = false
    private var opened = false

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
            map.setStyle(Style.Builder().fromJson(styleJson(template, minZoom, maxZoom))) { style -> route(style, line) }
        }
    }

    fun route(line: List<List<Double>>) {
        if (destroyed) return
        view.getMapAsync { map -> map.getStyle { style -> route(style, line) } }
    }

    /** Fresh open over the Chicago area, as the web app opens until a
     *  position comes (lib/map): own ship is a later phase, so until then
     *  the map opens there. */
    private fun open(map: MapLibreMap) {
        if (opened) return
        opened = true
        map.cameraPosition = CameraPosition.Builder().target(LatLng(41.9, -87.9)).zoom(8.0).build()
    }

    private fun route(style: Style, line: List<List<Double>>) {
        val geoJson = routeJson(line)
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

        /** The route as GeoJSON, whose coordinates are longitude first. */
        fun routeJson(line: List<List<Double>>): String = buildJsonObject {
            put("type", "FeatureCollection")
            putJsonArray("features") {
                if (line.size >= 2) {
                    addJsonObject {
                        put("type", "Feature")
                        putJsonObject("properties") {}
                        putJsonObject("geometry") {
                            put("type", "LineString")
                            putJsonArray("coordinates") {
                                for (point in line) {
                                    if (point.size == 2) addJsonArray {
                                        add(point[1])
                                        add(point[0])
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }.toString()
    }
}
