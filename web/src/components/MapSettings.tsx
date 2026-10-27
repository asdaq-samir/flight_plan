import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { editionOf } from "../lib/chartEdition";
import { ListGroup, ListRow } from "./GroupedList";
import PullDown from "./PullDown";
import Segmented from "./Segmented";
import { Switch } from "./ui/switch";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { clearOwnTrail, useOwnTrail } from "../lib/map/ownTrail";
import { BASE_CHARTS, usePreferences, type BaseChart, type ChartNight, type MapOverlay, type OverlayStrength } from "../lib/preferences";
import { useShownOverlay } from "../lib/map/useShownOverlay";
import { useGoogleSession } from "../lib/map/googleSession";
import { OWN_SHIP_LOOKS, ownShipSvg, type OwnShipLook } from "../lib/map/ownShipLook";
import { tileUrl } from "../lib/map/tiles";
import { cn } from "../lib/utils";
import { GROUP_HEADING, TEXT } from "../lib/text";
import { chartQuery, googleMapsQuery } from "../lib/queryClient";
import { useLayerAges } from "../lib/map/layerAges";

/**
 * The map's settings, the whole of the map's own button's sheet
 * (MapSettingsButton), laid out as Apple Maps' "Choose Map" card at the
 * owner's pick (2026-10-27, canvas RZDPvJ6hxfp93UL53LYLec): the chart and
 * what is over it as pictures, then what is drawn on the map as iOS's
 * switches, then how the chart looks, then where its data comes from. It
 * was one list of nineteen rows of three kinds of control; the alerts and
 * the charts kept offline, which work in the air whatever the map shows,
 * went to Settings' In Flight (SettingsPanel), and the chart at night and
 * own ship's look came here from there.
 */
export default function MapSettings() {
  const prefs = usePreferences();
  const trailed = useOwnTrail(s => s.path.length > 1);
  // A Google choice without a key is none (useShownOverlay).
  const overlay = useShownOverlay();
  // Google's only where the deployment has a key for it.
  const { data: google } = useQuery(googleMapsQuery);
  const googleSession = useGoogleSession(overlay === "google-satellite" ? "satellite" : "map", overlay.startsWith("google"));
  // The edition is what a pilot checks: a chart is current for its cycle.
  // adsb.lol's licence (ODbL 1.0, 4.3) asks it be credited, as the owner
  // asked it be here ("say traffic adsb.lol in settings like we do for
  // FAA"). Rows, not a footnote (the owner's "Avoid putting so many
  // footnotes").
  const { data: chart } = useQuery(chartQuery);
  // How old each weather layer's data is, beside where it comes from.
  const ages = useLayerAges();
  const sec = prefs.base === "sec";
  return (
    <div className="flex flex-col gap-5" data-testid="map-settings-groups">
      <PictureChoices
        title="Chart" value={prefs.base} onChange={v => prefs.setBase(v as BaseChart)} testId="base-chart-select"
        options={BASE_CHARTS.map(b => ({ value: b.kind, label: b.label, src: chart ? tileUrl(chart, b.kind, ...PICTURE_TILE) : undefined }))}
      />
      {/* Over the chart, at the pilot's ask (OverlayTiles): the USGS's
          aerial imagery, or Google's map or its satellite imagery where
          this deployment has a Google key; and how strongly it covers the
          chart, the route and the marks over it either way. */}
      <div className="flex flex-col gap-2">
        <PictureChoices
          title="Overlay" value={overlay.startsWith("google") ? "google" : overlay} testId="overlay-select"
          onChange={v => prefs.setOverlay((v === "google" ? "google-map" : v) as MapOverlay)}
          options={[
            { value: "none", label: "None", src: chart ? tileUrl(chart, prefs.base, ...PICTURE_TILE) : undefined, faded: true },
            { value: "usgs", label: "Imagery", src: USGS_PICTURE },
            ...(google ? [{ value: "google", label: "Google", className: "bg-[linear-gradient(135deg,#a8d5f2,#d9ecd1)]" }] : []),
          ]}
        />
        {overlay !== "none" && (
          <ListGroup>
            {overlay.startsWith("google") && google && (
              <ListRow title="Google">
                <Segmented
                  label="Google" value={overlay} onChange={v => prefs.setOverlay(v as MapOverlay)} testId="google-overlay-select"
                  options={[{ value: "google-map", label: "Map" }, { value: "google-satellite", label: "Satellite" }]}
                />
              </ListRow>
            )}
            <ListRow title="Strength">
              <Segmented
                label="Strength" value={prefs.overlayStrength} onChange={v => prefs.setOverlayStrength(v as OverlayStrength)} testId="overlay-strength"
                options={[{ value: "faint", label: "Faint" }, { value: "half", label: "Half" }, { value: "full", label: "Full" }]}
              />
            </ListRow>
          </ListGroup>
        )}
        {overlay.startsWith("google") && googleSession.isError && (
          // Where it happens: a key restricted to another site, the Map Tiles
          // API off or no quota leave Google's map blank otherwise.
          <p role="alert" className={cn("px-1 text-destructive-ink", TEXT.note)} data-testid="google-problem">
            Google's map didn't load. Check that this site and the Map Tiles API are allowed for the key.
          </p>
        )}
      </div>
      <ListGroup title="On the Map">
        {/* The route's VFR checkpoints, on either map: the planner's
            numbered checkpoints at every zoom and the dim landmarks they
            were chosen from closer in; off, the course line and its two
            airports alone. */}
        <SwitchRow title="VFR Checkpoints" on={prefs.waypoints} onChange={prefs.setWaypoints} testId="waypoints-toggle" />
        {/* The temporary flight restrictions, from tfr.faa.gov: on unless
            turned off, as a pilot must know of every one near the route
            (14 CFR 91.103). */}
        <SwitchRow title="TFRs" on={prefs.tfrs} onChange={prefs.setTfrs} testId="tfrs-toggle" />
        {/* The airplanes ADS-B receivers hear about the map (TrafficLayer),
            from adsb.lol: off unless turned on, as it asks a third party
            every five seconds. Setup's Controls has it too, for the
            cockpit, as iOS has Wi-Fi in Control Center and Settings. */}
        <SwitchRow title="Traffic" on={prefs.traffic} onChange={prefs.setTraffic} testId="traffic-toggle" />
        {/* The Class B airports' weather now, as chips on the map, and
            the terminal sheet over the base wherever there is one: the
            TAC over the sectional, the IFR area chart over the IFR
            charts. A chip's card pins its field's sheet either way. */}
        <SwitchRow title="Class B Weather" on={prefs.classB} onChange={prefs.setClassB} testId="class-b-toggle" />
        <SwitchRow title={sec ? "Terminal Area Charts" : "IFR Area Charts"} on={prefs.tac} onChange={prefs.setTac} testId="tac-toggle" />
        {/* The privately owned fields (the owner, 2026-10-27): off by
            default, as a field landed at only by its owner's leave, on to
            see them. */}
        <SwitchRow title="Private Fields" on={prefs.privateFields} onChange={prefs.setPrivateFields} testId="private-toggle" />
        {/* The fields the armed services own and keep to themselves: off by
            default, as most pilots may not land there without the
            service's permission. A joint-use field is drawn either way. */}
        <SwitchRow title="Military Fields" on={prefs.military} onChange={prefs.setMilitary} testId="military-toggle" />
      </ListGroup>
      <ListGroup title="Look">
        {/* The white paper chart dimmed in the dark theme, so it does not
            take the pilot's night vision; only its tiles (index.css). */}
        <ListRow title="Chart at Night">
          <Segmented
            label="Chart at night" value={prefs.chartNight} onChange={v => prefs.setChartNight(v as ChartNight)}
            testId="chart-night-select" options={[{ value: "normal", label: "Normal" }, { value: "dimmed", label: "Dimmed" }]}
          />
        </ListRow>
        {/* Own ship on the chart, a plane or the arrow, at the owner's ask:
            a menu, each with its picture. */}
        <ListRow title="You on the Map">
          <PullDown<OwnShipLook>
            label="You on the map" value={prefs.ownShipLook} onChange={prefs.setOwnShipLook} testId="own-ship-look"
            options={OWN_SHIP_LOOKS.map(o => ({
              value: o.value, text: o.label, testId: `own-ship-look-${o.value}`,
              label: (
                <>
                  <span className="size-5 shrink-0" dangerouslySetInnerHTML={{ __html: ownShipSvg(o.value, "#2563eb", 20) }} />
                  {o.label}
                </>
              ),
            }))}
          />
        </ListRow>
        {/* Own ship's path flown (OwnTrailLayer), put away here: it starts
            again by itself with the next flight. */}
        <ListRow title="Clear Your Path" disabled={!trailed} onClick={clearOwnTrail} data-testid="own-trail-clear" />
      </ListGroup>
      {/* Where the map's data comes from, and when the weather layers' is
          from (lib/map/layerAges): the METARs behind the airports'
          colours and the TFRs as the planner fetched them, the traffic as
          the map last heard it. */}
      <ListGroup title="Sources">
        <ListRow title="Charts" value={<span className="text-foreground">{chart ? `FAA, ${editionOf(chart.chart_cycle)}` : "FAA"}</span>} data-testid="chart-edition" />
        <ListRow title="METARs" value={<span className="text-foreground">{ages.metars ? `aviationweather.gov · ${ages.metars}` : "aviationweather.gov"}</span>} data-testid="metars-age" />
        <ListRow title="TFRs" value={<span className="text-foreground">{ages.tfrs ? `tfr.faa.gov · ${ages.tfrs}` : "tfr.faa.gov"}</span>} data-testid="tfrs-age" />
        <ListRow
          title="Traffic"
          value={<span className="text-foreground">{prefs.traffic && ages.traffic ? `adsb.lol · ODbL · ${ages.traffic}` : "adsb.lol · ODbL"}</span>}
          data-testid="traffic-age"
        />
      </ListGroup>
    </div>
  );
}

/** The one tile each choice's picture is cut from, z/x/y: Chicago at
 *  zoom 9, where every chart the planner draws has ink (a sectional's
 *  towns and Class B, the IFR charts' airways), so the pictures tell the
 *  charts apart as Apple Maps' tell its maps apart. */
const PICTURE_TILE = [9, 130, 190] as const;
/** The USGS's imagery of the same tile (OverlayTiles' service: z/y/x). */
const USGS_PICTURE = `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${PICTURE_TILE[0]}/${PICTURE_TILE[2]}/${PICTURE_TILE[1]}`;

/** A pick of one of a few, each a picture over its word, as Apple Maps'
 *  map types are: the stock ToggleGroup underneath, so each is a radio to
 *  a screen reader and the arrow keys move between them. A picture that
 *  does not load leaves its muted box. */
function PictureChoices({ title, value, onChange, options, testId }: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; src?: string; className?: string; faded?: boolean }[];
  testId: string;
}) {
  return (
    <section className="flex flex-col">
      <h3 className={cn("px-1 pb-1.5", GROUP_HEADING)}>{title}</h3>
      <ToggleGroup
        type="single" value={value} onValueChange={v => { if (v) onChange(v); }} aria-label={title} data-testid={testId}
        className="grid w-full grid-cols-3 gap-2"
      >
        {options.map(o => (
          <ToggleGroupItem
            key={o.value} value={o.value} aria-label={o.label}
            className={cn(
              "group flex h-auto min-w-0 flex-col items-stretch gap-1 rounded-lg border-0 bg-transparent p-0 shadow-none",
              "hover:bg-transparent data-[state=on]:bg-transparent",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative block aspect-[4/3] overflow-hidden rounded-lg bg-muted ring-1 ring-border",
                "group-data-[state=on]:ring-[3px] group-data-[state=on]:ring-tint",
                o.className,
              )}
            >
              {o.src && (
                <img
                  src={o.src} alt="" loading="lazy" decoding="async" draggable={false}
                  className={cn("size-full object-cover", o.faded && "opacity-40")}
                  onError={e => { e.currentTarget.style.visibility = "hidden"; }}
                />
              )}
            </span>
            <span className={cn("truncate text-center text-foreground group-data-[state=on]:font-semibold group-data-[state=on]:text-tint", TEXT.note)}>
              {o.label}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  );
}

/** An on-or-off row, as iOS's Settings has them: its name, and the stock
 *  switch at its end, the name its label so a tap on either works it. */
function SwitchRow({ title, on, onChange, testId, disabled }: {
  title: string;
  on: boolean;
  onChange: (on: boolean) => void;
  testId: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <ListRow id={id} title={title}>
      <Switch id={id} checked={on} onCheckedChange={onChange} disabled={disabled} data-testid={testId} />
    </ListRow>
  );
}

