import { Bell, BellOff, CloudSun, Download, Eye, EyeOff, Map as MapIcon, Plane, Trash2, Volume2, VolumeX } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { editionOf } from "../lib/chartEdition";
import { ListGroup, ListRow } from "./GroupedList";
import Segmented from "./Segmented";
import TogglePill from "./TogglePill";
import { Button } from "./ui/button";
import { clearOwnTrail, useOwnTrail } from "../lib/map/ownTrail";
import { say } from "../lib/speech";
import { keepingAvailable } from "../lib/map/keepRoute";
import { BASE_CHARTS, usePreferences, type BaseChart, type MapOverlay, type OverlayStrength } from "../lib/preferences";
import { useShownOverlay } from "../lib/map/useShownOverlay";
import { useGoogleSession } from "../lib/map/googleSession";
import { cn } from "../lib/utils";
import { TEXT } from "../lib/text";
import { inNativeApp } from "../lib/native";
import { useReceiver } from "../lib/map/receiver";
import { chartQuery, googleMapsQuery } from "../lib/queryClient";
import { useLayerAges } from "../lib/map/layerAges";

/**
 * The map's settings, the whole of the map's own button's sheet
 * (MapSettingsButton), as Maps' map button holds its map's -- moved out
 * of the console's Settings at the pilot's ask: the chart, what is drawn
 * over it, Class B's weather and terminal sheet, the waypoints, the TFRs, the alerts in
 * flight, the traffic, and keeping charts offline, with the charts' edition
 * under them.
 */
export default function MapSettings() {
  const base = usePreferences(s => s.base);
  const tac = usePreferences(s => s.tac);
  const classB = usePreferences(s => s.classB);
  const setBase = usePreferences(s => s.setBase);
  const setTac = usePreferences(s => s.setTac);
  const setClassB = usePreferences(s => s.setClassB);
  const tfrs = usePreferences(s => s.tfrs);
  const setTfrs = usePreferences(s => s.setTfrs);
  const alerts = usePreferences(s => s.alerts);
  const traffic = usePreferences(s => s.traffic);
  const trailed = useOwnTrail(s => s.path.length > 1);
  const setTraffic = usePreferences(s => s.setTraffic);
  const setAlerts = usePreferences(s => s.setAlerts);
  const speakAlerts = usePreferences(s => s.speakAlerts);
  const setSpeakAlerts = usePreferences(s => s.setSpeakAlerts);
  const military = usePreferences(s => s.military);
  const setMilitary = usePreferences(s => s.setMilitary);
  const privateFields = usePreferences(s => s.privateFields);
  const setPrivateFields = usePreferences(s => s.setPrivateFields);
  const waypoints = usePreferences(s => s.waypoints);
  const setWaypoints = usePreferences(s => s.setWaypoints);
  // A Google choice without a key is none (useShownOverlay).
  const overlay = useShownOverlay();
  const setOverlay = usePreferences(s => s.setOverlay);
  const strength = usePreferences(s => s.overlayStrength);
  const setStrength = usePreferences(s => s.setOverlayStrength);
  // Google's only where the deployment has a key for it.
  const { data: google } = useQuery(googleMapsQuery);
  const googleSession = useGoogleSession(overlay === "google-satellite" ? "satellite" : "map", overlay.startsWith("google"));
  const keepOffline = usePreferences(s => s.keepOffline);
  const setKeepOffline = usePreferences(s => s.setKeepOffline);
  const available = keepingAvailable();
  // Where the charts come from and which edition is up, under the map's
  // settings: it was a credit in the chart's corner, which the FAA's
  // charts, a US government work, do not ask for. The edition is what a
  // pilot checks: a chart is current for its cycle. The traffic's source
  // beside them whether it is shown or not, at the owner's ask ("say
  // traffic adsb.lol in settings like we do for FAA"), as its licence
  // (ODbL 1.0, 4.3) asks it be credited; what it is good for, once on.
  const { data: chart } = useQuery(chartQuery);
  // How old each weather layer's data is, beside where it comes from.
  const ages = useLayerAges();
  return (
    <ListGroup title="Map">
      <ListRow title="Chart">
        <Segmented
          label="Chart" value={base} onChange={v => setBase(v as BaseChart)} testId="base-chart-select"
          options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label }))}
        />
      </ListRow>
      {/* Over the chart, at the pilot's ask (OverlayTiles): the USGS's
          aerial imagery, or Google's map or its satellite imagery where
          this deployment has a Google key; and how strongly it covers the
          chart, the route and the marks over it either way. */}
      <ListRow title="Overlay">
        <Segmented
          label="Overlay" value={overlay.startsWith("google") ? "google" : overlay} testId="overlay-select"
          onChange={v => setOverlay((v === "google" ? "google-map" : v) as MapOverlay)}
          options={[{ value: "none", label: "Off" }, { value: "usgs", label: "Imagery" }, ...(google ? [{ value: "google", label: "Google" }] : [])]}
        />
      </ListRow>
      {overlay.startsWith("google") && google && (
        <ListRow title="Google">
          <Segmented
            label="Google" value={overlay} onChange={v => setOverlay(v as MapOverlay)} testId="google-overlay-select"
            options={[{ value: "google-map", label: "Map" }, { value: "google-satellite", label: "Satellite" }]}
          />
        </ListRow>
      )}
      {overlay.startsWith("google") && googleSession.isError && (
        // Where it happens: a key restricted to another site, the Map Tiles
        // API off or no quota leave Google's map blank otherwise.
        <p role="alert" className={cn("px-4 text-destructive-ink", TEXT.note)} data-testid="google-problem">
          Google's map didn't load. Check that this site and the Map Tiles API are allowed for the key.
        </p>
      )}
      {overlay !== "none" && (
        <ListRow title="Strength">
          <Segmented
            label="Strength" value={strength} onChange={v => setStrength(v as OverlayStrength)} testId="overlay-strength"
            options={[{ value: "faint", label: "Faint" }, { value: "half", label: "Half" }, { value: "full", label: "Full" }]}
          />
        </ListRow>
      )}
      {/* The Class B airports' two things, on one line: their weather
          now, as chips on the map, and the terminal sheet over the base
          wherever there is one -- the TAC over the sectional, the IFR
          area chart over the IFR charts. Each on or off by itself; they
          were two rows of switches. A chip's card pins its field's
          sheet either way. */}
      <ListRow title="Class B">
        <div className="flex gap-2" role="group" aria-label="Class B">
          <TogglePill pressed={classB} onPressedChange={setClassB} icon={<CloudSun />} label="Weather" testId="class-b-toggle" />
          {/* TAC, as pilots call the sectional's terminal area chart; its
              IFR counterpart is the area chart. */}
          <TogglePill pressed={tac} onPressedChange={setTac} icon={<MapIcon />} label={base === "sec" ? "TAC" : "Area"} testId="tac-toggle" />
        </div>
      </ListRow>
      {/* The route's VFR checkpoints, on either map: the planner's
          numbered checkpoints at every zoom and the dim landmarks they
          were chosen from closer in, the training map's detections; off,
          the course line and its two airports alone. Named so at the
          owner's ask ("rename Waypoints to VFR Checkpoints"). */}
      <ListRow title="VFR Checkpoints">
        <TogglePill pressed={waypoints} onPressedChange={setWaypoints} icon={waypoints ? <Eye /> : <EyeOff />} label="Show" testId="waypoints-toggle" />
      </ListRow>
      {/* The temporary flight restrictions, from tfr.faa.gov: on unless
          turned off, as a pilot must know of every one near the route. */}
      <ListRow title="TFRs">
        <TogglePill pressed={tfrs} onPressedChange={setTfrs} icon={tfrs ? <Eye /> : <EyeOff />} label="Show" testId="tfrs-toggle" />
      </ListRow>
      {/* What is ahead of own ship in the air, over the map (AlertsBanner):
          on unless turned off; and said aloud (lib/map/speak), off unless
          turned on. Turned on, it says so: a voice heard then is one the
          pilot knows to expect, and on an iPhone the tap lets the page
          speak at all. */}
      <ListRow title="Alerts">
        <div className="flex gap-2" role="group" aria-label="Alerts">
          <TogglePill pressed={alerts} onPressedChange={setAlerts} icon={alerts ? <Bell /> : <BellOff />} label="In flight" testId="alerts-toggle" />
          <TogglePill
            pressed={alerts && speakAlerts} disabled={!alerts}
            onPressedChange={on => { setSpeakAlerts(on); if (on) say("Alerts will be spoken."); }}
            icon={alerts && speakAlerts ? <Volume2 /> : <VolumeX />} label="Spoken" testId="speak-alerts-toggle"
          />
        </div>
      </ListRow>
      {/* The airplanes ADS-B receivers hear about the map (TrafficLayer),
          from adsb.lol: off unless turned on, as it asks a third party
          every five seconds. */}
      <ListRow title="Traffic">
        <TogglePill pressed={traffic} onPressedChange={setTraffic} icon={<Plane />} label="Show" testId="traffic-toggle" />
      </ListRow>
      {/* A cockpit receiver's traffic (lib/map/receiver), heard in the app
          while the traffic is shown: what it is doing, in words. */}
      {inNativeApp() && <ListRow title="Receiver" value={<ReceiverStatus on={traffic} />} />}
      {/* Own ship's path flown (OwnTrailLayer), put away here: it starts
          again by itself with the next flight. */}
      <ListRow title="Your path">
        <Button
          type="button" size="sm" variant="ghost" className="rounded-full text-tint" disabled={!trailed}
          onClick={clearOwnTrail} data-testid="own-trail-clear"
        >
          <Trash2 /> Clear
        </Button>
      </ListRow>
      {/* The fields the armed services own and keep to themselves, at the
          pilot's ask: off by default, as most pilots may not land there
          without the service's permission. A joint-use field, a civil
          airport on a military one, is drawn either way. */}
      <ListRow title="Military">
        <TogglePill pressed={military} onPressedChange={setMilitary} icon={military ? <Eye /> : <EyeOff />} label="Show" testId="military-toggle" />
      </ListRow>
      {/* The privately owned fields (the owner, 2026-10-27): off by
          default, as a field landed at only by its owner's leave, on to
          see them. */}
      <ListRow title="Private">
        <TogglePill
          pressed={privateFields} onPressedChange={setPrivateFields} icon={privateFields ? <Eye /> : <EyeOff />}
          label="Show" testId="private-toggle"
        />
      </ListRow>
      {/* The base chart along each route loaded, held for the air
          (useKeepOffline); how a keep goes is its toast. Over plain http
          there is no service worker to hold it, and it cannot be on. */}
      <ListRow title="Offline">
        <TogglePill
          pressed={keepOffline && available} onPressedChange={setKeepOffline} disabled={!available}
          icon={<Download />} label="Keep charts" testId="keep-offline-toggle"
        />
      </ListRow>
      {/* The chart's edition and the traffic's source, rows where they were
          a footnote (the owner's "Avoid putting so many footnotes"): the
          edition is what a pilot checks, and adsb.lol's licence (ODbL 1.0,
          4.3) asks it be credited, as the owner asked it be here. */}
      <ListRow title="Charts" value={<span className="text-foreground">{chart ? `FAA, ${editionOf(chart.chart_cycle)}` : "FAA"}</span>} data-testid="chart-edition" />
      {/* When the weather layers' data is from (lib/map/layerAges): the
          METARs behind the airports' colours and the TFRs as the planner
          fetched them, the traffic as the map last heard it. */}
      <ListRow title="METARs" value={<span className="text-foreground">{ages.metars ? `aviationweather.gov · ${ages.metars}` : "aviationweather.gov"}</span>} data-testid="metars-age" />
      <ListRow title="TFR data" value={<span className="text-foreground">{ages.tfrs ? `tfr.faa.gov · ${ages.tfrs}` : "tfr.faa.gov"}</span>} data-testid="tfrs-age" />
      <ListRow
        title="Traffic data"
        value={<span className="text-foreground">{traffic && ages.traffic ? `adsb.lol · ODbL · ${ages.traffic}` : "adsb.lol · ODbL"}</span>}
        data-testid="traffic-age"
      />
    </ListGroup>
  );
}

/** The cockpit receiver, in a few words: whether it is heard, and what. */
function ReceiverStatus({ on }: { on: boolean }) {
  const listening = useReceiver(s => s.listening);
  const connected = useReceiver(s => s.connected);
  const count = useReceiver(s => Object.keys(s.traffic).length);
  const error = useReceiver(s => s.error);
  const words = !on ? "With Traffic on"
    : error ? "Can't listen on the Wi-Fi"
      : connected ? `Connected · ${count} ${count === 1 ? "airplane" : "airplanes"}`
        : listening ? "Listening on the Wi-Fi" : "Starting…";
  return <span className={connected && on ? "font-semibold text-foreground" : "text-muted-foreground"} data-testid="receiver-status">{words}</span>;
}
