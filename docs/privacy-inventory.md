# What Wingtip Maps collects

This list is read from the code and is the one source for the privacy
policy (`web/src/lib/legal`), App Store Connect's App Privacy answers,
Google Play's Data safety form and the iOS app's privacy manifest
(`PrivacyInfo.xcprivacy`). Change it
whenever the code changes what leaves a device or what the server keeps.
Last checked against the code on 2026-10-11.

"Collected" is App Store Connect's meaning: sent off the device and kept
longer than it takes to answer the request.

## Data the app collects

| App Store category | What exactly | Linked to the pilot | Why | Where it is kept |
|---|---|---|---|---|
| Contact Info, Email Address | The address a pilot signs in with | Yes | App Functionality (sign-in, the sign-in link; currency reminders where the pilot turns them on) | `pilots`, `magic_links`, `reminders_sent` (Postgres) |
| Contact Info, Name | The name Google or Apple gives at sign-in (otherwise the address); the name as on their pilot certificate, where they give it for endorsements | Yes | App Functionality | `pilots` |
| Identifiers, User ID | The account's id; Google's and Apple's subject for that sign-in | Yes | App Functionality | `pilots`, the session |
| User Content, Other | Aircraft (tail number, type, performance, the last VOR check, the inspections' and tests' dates and its hours, its checklist and its squawks), saved flights and their nav logs, the logbook (its instrument approaches, holding and tracking among it), endorsements and currency dates (the instrument proficiency check's too), checkpoint notes a pilot writes for themselves; a flight instructor's certificate number and its date, the instructors a student asks in by address, the saved flights a student puts to them, and the endorsements signed in the app | Yes | App Functionality | Postgres; notes in the planner's `data/labels` |
| Location, Precise | A flight's track, when a pilot saves it to a flight | Yes | App Functionality | `flight_tracks` |
| Purchases, Purchase History | The subscription: when the free month started and ends, and a paid plan's term, its store and the store's own id for it | Yes | App Functionality (the paid features) | `subscriptions` |
| Usage Data, Product Interaction | How many of each Claude-written feature (the written briefing, checkpoint descriptions, the mock oral) a pilot used this month, a count, for its monthly cap | Yes | App Functionality (the cap) | `paid_feature_uses` |
| Diagnostics, Crash Data | An uncaught error on the device: its message, stack, the page's path, the browser's name (`lib/errorReports`) | No | App Functionality (finding faults) | The server's log in CloudWatch, 30 days |
| Diagnostics, Performance Data | How fast a page was on the device: Core Web Vitals (LCP, INP, CLS, FCP, TTFB), the page's name, phone, tablet or desktop, and the app's build; nothing of the pilot's (`lib/speed`, SpeedController) | No | App Functionality (keeping the app fast) | `speed_samples` (Postgres), 400 days |

## Data that leaves the device but is not collected

- **Position for Nearest, the map and the airspace at a point.** The
  device's position goes to the planner to answer and is not kept: the
  planner writes no access log in production (`docker-compose.prod.yml`),
  and nothing stores it (the webapp's log of a planner outage names the path only). The position itself is read on the device, with
  the permission the browser, iOS or Android asks for.
- **A cockpit receiver's traffic and FIS-B weather** (the iOS and Android
  apps, with Traffic on): heard on the cockpit's Wi-Fi and shown on the
  device; nothing of it is sent anywhere.
- **A route's airports and stops**, to plan it. Kept only as a pilot's
  saved flight (above).

## Who else receives what

| Recipient | What | Personal |
|---|---|---|
| Anthropic (Claude) | For a briefing: the route, the nav log, the weather on it and the aircraft's stock profile and figures. For a checkpoint note: the checkpoint and the route around it | No name, address, account or tail number |
| Amazon SES | The address a sign-in link is sent to, and the link; an instructor's address a student asks in, with the student's name and address; the endorsements and reviews between the two, to each | Yes, to deliver it |
| The student's instructor | Once they take the student on: the student's name and address, 61.109 experience from their logbook, knowledge test codes, endorsements, and the saved flights the student puts to them | Yes: the student asks them in, and either ends it |
| Google, Apple | Their own sign-in, when a pilot uses it | Their own |
| FAA, NOAA (aviationweather.gov) | Chart and data downloads, weather for airports | None: the server asks, not the device |
| adsb.lol | For the traffic on the map, the middle of the area asked about (rounded to a half-degree cell) and, for an airplane a pilot tracks, its transponder's address | None: the server asks, not the device; the device's position itself is not sent |
| USGS (basemap.nationalmap.gov) | With its imagery overlay on, the map's tiles in view, asked by the device | None: the tiles' coordinates, as any web map's |
| Google (tile.googleapis.com) | With a Google overlay on, a session and the map's tiles in view, asked by the device with the site's key | None of the pilot's: the tiles' coordinates and the view, as any Google map's; Google's own terms and privacy policy apply to the request |
| US Census Bureau (geocoding.geo.census.gov) | A street address typed in Nearest's field, to place it; its gazetteer of towns is downloaded once | The address typed, from the server, not the device; not stored, but the text typed is in request logs, and a place picked is in the page address (`nearName`, `nearAt`) |
| Amazon Web Services | Hosting all of the above (us-east-1) | As above |

## Not done

- **No tracking**, in Apple's sense: no advertising, no analytics SDK, no
  data broker, nothing joined with others' data. App Store Connect:
  "Data Not Used to Track You".
- **No analytics**: the only usage kept is the month's count of each
  Claude-written feature, for its cap (above).
- **Purchases** are the stores' own: the app keeps only the plan's term
  and the store's id for it (above), never a card.
- Deleting an account (`DELETE /api/me`) removes everything linked to it
  above, its sessions and its sign-in links, and the device's own copies.
  The unlinked error lines age out of CloudWatch in 30 days.

## Google Play's Data safety form

The same rows, in Google's words: **Personal info** (email address,
name, user IDs), **Location** (precise, only a saved flight's track; the
device's live position is not kept, see above),
**App activity** (other user-generated content: aircraft, flights,
logbook, notes) and **App info and performance** (crash logs and
diagnostics, not linked: not tied to the account; crash logs gone from
the log after 30 days, speed measurements after 400).
All collected for app functionality and account management,
none shared with third parties as Google defines sharing (the
recipients above process data for the app), all encrypted in transit,
and all but the crash logs and speed measurements deleted with the
account (they carry no account, so a deletion request cannot reach
them; they expire on their own). The Android app asks for location
while it is open only, never in the background.

## The iOS app's privacy manifest

When the iOS project exists (#102), `PrivacyInfo.xcprivacy` declares:

- `NSPrivacyTracking`: false, with no tracking domains;
- `NSPrivacyCollectedDataTypes`: the seven rows of the first table, with
  their linkage and purposes as above;
- `NSPrivacyAccessedAPITypes`: the required-reason APIs the native shell
  and its plugins use, at least `NSPrivacyAccessedAPICategoryUserDefaults`
  (reason `CA92.1`, the app's own settings).

## Kept after an account is deleted

An endorsement an instructor signed in the app stays with the other of the two when either deletes their account, with the student's name as signed and the deleted account left out: it is the student's endorsement, and 14 CFR 61.189(b) and (c) ask the instructor to keep a record of it for 3 years (`signed_endorsements`).
