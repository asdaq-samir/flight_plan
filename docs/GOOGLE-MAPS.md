# Google Maps over the chart

The map can draw an overlay over the FAA chart (the map's button →
Overlay), and set how strongly it covers the chart: Faint, Half or Full.
The overlay is one of:

- **Imagery:** the USGS's aerial imagery of the United States (The
  National Map's orthoimagery). It is a public-domain work and is always
  offered.
- **Google:** Google's map, or its satellite imagery with Google's roads
  and names over it. It is offered only where the deployment has a
  Google key (`GOOGLE_MAPS_API_KEY`).

How the Google overlay works:

- **Session.** The browser asks Google's Map Tiles API for a session for
  the kind of map, and keeps the session for its two weeks (`OverlayTiles`).
- **Tiles.** The browser draws the tiles from that session.
- **Credit.** The map's lower corner says "Google Maps" with the data's
  copyright for the view, from Google's viewport service, as Google's
  policies ask.
- **No copies.** The app keeps no copy of Google's tiles: the service
  worker leaves them to the network, and Google's terms forbid storing
  or prefetching them.

## What only the owner can do

1. **A Google Cloud project with billing** (console.cloud.google.com).
   The Map Tiles API has a free monthly allowance and is then billed per
   thousand tiles; see Google Maps Platform's pricing.
2. **Enable the Map Tiles API** in the project (APIs & Services →
   Library).
3. **Create an API key** (APIs & Services → Credentials) and restrict
   it:
   - **Application restrictions:** Websites, with the site's address
     (`https://<the domain>/*`). For the phone stack at home, add
     `https://10.0.0.218:8443/*` and `http://localhost:8080/*`.
   - **API restrictions:** the Map Tiles API alone.

   The key reaches every visitor's browser, as a browser key must. The
   restrictions are what keep it to this site.
4. **Give it to the stack:**
   - On the server: `GOOGLE_MAPS_API_KEY` in the stack's AppSecret
     (`infra/server/env.example`), then run `deploy.sh`.
   - At home: `GOOGLE_MAPS_API_KEY=...` in `.env`, then
     `docker compose up -d planning-service`.

   The map's settings offer Google from the next page load.

## Restaurant photos, stars and reviews (Fly-in Food)

Fly-in Food shows each restaurant's photo, its stars and how many rated it,
and, under its name, a few photos and reviews, from Google's Places API (New).
The planner asks Google from the server, one Text Search per restaurant,
asking only those fields; the browser then loads the photos from Google's
own servers. Nothing is kept: Google's terms allow keeping a place's id alone.
With no key, the rows show as before.

What only the owner can do:

1. In the same Google Cloud project, **enable the Places API (New)**. It is
   billed per request after a free monthly allowance; Text Search with
   photos and reviews is one of its dearer kinds, see Google Maps
   Platform's pricing.
2. **Create a second API key for the server** (the Map Tiles key above is a
   browser key, restricted to the site's address, which Google refuses for a
   server's call):
   - **Application restrictions:** IP addresses, with the server's address
     (none needed for the stack at home).
   - **API restrictions:** the Places API (New) alone.
3. **Give it to the stack** as `GOOGLE_PLACES_API_KEY` (the AppSecret on the
   server, `.env` at home), then restart the planning-service.
