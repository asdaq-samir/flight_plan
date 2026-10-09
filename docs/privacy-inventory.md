# What Wingtip Maps collects

This list is read from the code and is the one source for the privacy
policy (`web/src/lib/legal`), App Store Connect's App Privacy answers
and the iOS app's privacy manifest (`PrivacyInfo.xcprivacy`). Change it
whenever the code changes what leaves a device or what the server keeps.
Last checked against the code on 2026-10-08.

"Collected" is App Store Connect's meaning: sent off the device and kept
longer than it takes to answer the request.

## Data the app collects

| App Store category | What exactly | Linked to the pilot | Why | Where it is kept |
|---|---|---|---|---|
| Contact Info, Email Address | The address a pilot signs in with | Yes | App Functionality (sign-in, the sign-in link) | `pilots`, `magic_links` (Postgres) |
| Contact Info, Name | The name Google or Apple gives at sign-in (otherwise the address) | Yes | App Functionality | `pilots` |
| Identifiers, User ID | The account's id; Google's and Apple's subject for that sign-in | Yes | App Functionality | `pilots`, the session |
| User Content, Other | Aircraft (tail number, type, performance), saved flights and their nav logs, the logbook, endorsements and currency dates, checkpoint notes a pilot writes for themselves | Yes | App Functionality | Postgres; notes in the planner's `data/labels` |
| Location, Precise | A flight's track, when a pilot saves it to a flight | Yes | App Functionality | `flight_tracks` |
| Diagnostics, Crash Data | An uncaught error on the device: its message, stack, the page's path, the browser's name (`lib/errorReports`) | No | App Functionality (finding faults) | The server's log in CloudWatch, 30 days |

## Data that leaves the device but is not collected

- **Position for Nearest, the map and the airspace at a point.** The
  device's position goes to the planner to answer and is not kept: the
  planner writes no access log in production (`docker-compose.prod.yml`),
  and nothing stores it (the webapp's log of a planner outage names the path only). The position itself is read on the device, with
  the permission the browser or iOS asks for.
- **A route's airports and stops**, to plan it. Kept only as a pilot's
  saved flight (above).

## Who else receives what

| Recipient | What | Personal |
|---|---|---|
| Anthropic (Claude) | For a briefing: the route, the nav log, the weather on it and the aircraft's stock profile and figures. For a checkpoint note: the checkpoint and the route around it | No name, address, account or tail number |
| Amazon SES | The address a sign-in link is sent to, and the link | Yes, to deliver it |
| Google, Apple | Their own sign-in, when a pilot uses it | Their own |
| FAA, NOAA (aviationweather.gov) | Chart and data downloads, weather for airports | None: the server asks, not the device |
| US Census Bureau (geocoding.geo.census.gov) | A street address typed in Nearest's field, to place it; its gazetteer of towns is downloaded once | The address typed, from the server, not the device; not kept |
| Amazon Web Services | Hosting all of the above (us-east-1) | As above |

## Not done

- **No tracking**, in Apple's sense: no advertising, no analytics SDK, no
  data broker, nothing joined with others' data. App Store Connect:
  "Data Not Used to Track You".
- **No usage data or analytics.**
- **No purchases.**
- Deleting an account (`DELETE /api/me`) removes everything linked to it
  above, its sessions and its sign-in links, and the device's own copies.
  The unlinked error lines age out of CloudWatch in 30 days.

## The iOS app's privacy manifest

When the iOS project exists (#102), `PrivacyInfo.xcprivacy` declares:

- `NSPrivacyTracking`: false, with no tracking domains;
- `NSPrivacyCollectedDataTypes`: the six rows of the first table, with
  their linkage and purposes as above;
- `NSPrivacyAccessedAPITypes`: the required-reason APIs the native shell
  and its plugins use, at least `NSPrivacyAccessedAPICategoryUserDefaults`
  (reason `CA92.1`, the app's own settings).
