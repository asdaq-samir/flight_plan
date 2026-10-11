---
name: pricing-and-paywall
description: Decide what is free and what is paid, at what price, and how the paywall, trial and caps work - store fees, App Store rules, the server-side entitlement and the cost of Claude-backed features. Use when adding or changing a paid feature, setting or changing a price or tier, building the subscription, trial or caps, or when a feature's running cost could exceed what a subscriber pays.
---

# Pricing and paywall

The app is free to plan and fly with; the subscription ($1 a month or $10 a year at the founding price, with a month's trial of the paid features) pays for what costs money to run. The owner sets prices and tiers; this skill prepares the decision and builds it right.

## 1. Free or paid
- **Always free:** anything that keeps a pilot legal or safe - charts, the route, checkpoints, the nav log, altitudes, fuel, weather, TFRs, NOTAMs, airspace, the Go / No-Go, alerts, checklists, the glide ring, currency and inspection reminders.
- **Paid:** what costs money per use or saves real time - Claude-written briefings and descriptions, the mock oral, debriefs, sync across devices, and new tiers the owner names (IFR planning, clubs, FBO listings).
- A feature that is paid elsewhere but costs nothing to run here can be free if it spreads the app (the `business-opportunity` skill decides).

## 2. Price
- Compare with competitors' current, dated prices (ForeFlight, Garmin Pilot, WeatherSpork) from their own pages.
- Work out what is kept: Apple and Google take 15% under their small-business programs (Apple's needs enrolling each year; 30% without), and a web card charge costs about 2.9% + $0.30, which is a third of a $1 charge - steer the web to yearly.
- Check the cost to serve a heavy user stays under what they pay; if not, cap it (below).
- A price change never reaches a subscriber mid-term; founding subscribers keep their price.
- Write the decision for the owner with the numbers; don't change a price without them.

## 3. Build it
- **One entitlement, on the server:** the webapp records each pilot's plan (store or Stripe, trial, renewal date) from the stores' server notifications (App Store Server Notifications, Google Real-time Developer Notifications) and Stripe webhooks; the planner and the webapp check it on every paid request. The app's own state is only for display.
- **Stores' rules:** a paid digital feature in the iOS app is sold through in-app purchase (StoreKit 2); the trial is the store's introductory offer, once per account. Read the current App Store Review Guidelines section 3.1 before shipping.
- **Caps:** a monthly allowance per subscriber for each Claude-backed feature, counted on the server, with the remaining count shown where the feature is.
- **The paywall:** shown where the paid feature is, in the app's own iOS look (the `iphone-review` skill), saying what it unlocks, the price and the trial; never a modal over planning, never over safety information.
- **API:** a changed request or response regenerates `openapi.json` and the web types (CLAUDE.md, "Checks"); tests cover free, trial, paid, expired and capped.

## Report
What is free and paid and why, the price with fees and cost to serve, the caps, how the entitlement is checked, the tests, and what the owner must do in the store consoles.
