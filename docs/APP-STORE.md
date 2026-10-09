# The App Store listing

What App Store Connect asks for, ready to paste once the app is there
(`docs/IOS.md` has how it gets there). Every claim here is one the app
makes good today; keep it so.

## The listing

| Field | Text |
|---|---|
| Name | Wingtip Maps |
| Subtitle (30) | VFR charts, routes and nav logs |
| Primary category | Navigation |
| Secondary category | Weather |
| Age rating | 4+ (no objectionable content, no user-to-user content) |
| Price | Free |
| Support URL | `https://<domain>/app/support.html` |
| Privacy policy URL | `https://<domain>/app/privacy.html` |
| Copyright | 2026 Wingtip Maps |

**Promotional text (170):** Plan a VFR flight on the FAA's own charts:
the route, checkpoints you can see from the air, a nav log with the
winds aloft, and the weather and airspace along the way.

**Keywords (100):**
`VFR,sectional,flight planning,nav log,pilot,aviation,checkpoints,METAR,TAF,airspace,TFR,student pilot`

**Description:**

> Wingtip Maps is the FAA chart on a map that works like Maps on your
> iPhone, and everything a VFR flight needs on top of it.
>
> - The current FAA sectional, terminal area and IFR enroute charts,
>   kept for the air: the charts you have looked at work with no signal.
> - Type a route and see it drawn: the course, its stops, and
>   checkpoints picked off the chart that you can actually see from the
>   air, each with a note on how to recognise it.
> - A nav log with headings, groundspeeds, times and fuel from the
>   winds aloft, and a cruising altitude chosen for terrain, airspace and
>   the clouds.
> - The METARs and TAFs along the way, the TFRs and special-use airspace
>   on the route, and a briefing in plain words.
> - Every airport's card: its airspace, runways, frequencies, lighting
>   and the weather there now.
> - Your airplanes, flights, logbook and currency, saved to your account
>   with Sign in with Apple or an emailed link.
>
> Wingtip Maps is a planning aid. It is not approved for navigation and
> does not replace an official weather briefing or the pilot in
> command's own preflight.

## App Privacy

Answer from `docs/privacy-inventory.md`, the one source:

- **Data used to track you:** none.
- **Data linked to you:** Contact Info (email address, name),
  Identifiers (user ID), User Content (other: airplanes, flights,
  logbook, notes), Location (precise: a flight's saved track). All for
  App Functionality.
- **Data not linked to you:** Diagnostics (crash data). App
  Functionality.

## App Review information

**Sign-in required:** no. A route, its nav log, the briefing and the
charts need no account.

**Notes for review:**

> No account is needed to plan a flight: type two airports (for
> example KMSN and KDLH) in the search bar at the bottom. To try the
> account features -- saving an airplane, and Delete account, in the
> console's menu under Sign out -- use Sign in with Apple. Location is
> asked for when the map first opens, to open the chart on where you
> are, as Maps does, and to draw the airplane on it; declined, the map
> opens on the country and the location arrow asks again. The first
> open needs a connection; after that, the charts already looked at
> work offline.

## Screenshots

App Store Connect wants 6.9" iPhone screenshots (1320 × 2868) and, for
the iPad, 13" ones (2064 × 2752). The browser suite's iOS audit
renders both sizes (`e2e/ios/audit.spec.ts`, projects
`iphone-16-pro-max` and `ipad-pro-13`, `SCREENSHOTS=<folder>`); take
them signed in as a pilot, not the developer, on a route such as
KMSN to KDLH: the map with the route, the nav log, the briefing, an
airport's card, and the charts offline.
