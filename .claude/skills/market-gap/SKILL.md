---
name: market-gap
description: Check what pilots can already get before proposing or building a feature. Covers ForeFlight, Garmin Pilot, WeatherSpork, CloudAhoy, FltPlan Go, SkyVector and the public FAA and NWS products. Use when suggesting features, planning the roadmap, or starting anything new a pilot would see. Lead with what no one else offers, and take solved things in as inputs rather than rebuilding them.
---

# Market gap

The owner is building a product for a need pilots have, not a demo of things that already exist. A feature that ForeFlight or the National Weather Service already does well is wasted effort, and a homemade copy is usually worse.

## 1. Name the pilot's job
In one sentence, say what the pilot is trying to do, when in the flight, and what goes wrong today. For example: "before a cross-country, pick visual checkpoints I can actually see from the air".

## 2. Survey what exists, with today's date
Search each product's current features and release notes. Products change, so date every finding.
- **Apps:** ForeFlight, Garmin Pilot, WeatherSpork, CloudAhoy, FltPlan Go, SkyVector, and any app that dominates the specific job.
- **Public data:**
  - NWS: the National Blend of Models, LAMP, the Graphical Forecasts for Aviation, METAR, TAF, PIREPs and winds aloft.
  - FAA: NOTAMs, TFRs, the Chart Supplement, NASR and the charts.
  - If the job is a forecast, a calibrated public product probably exists already.

## 3. Give a verdict per source

| Source | Does it do the job? | How well | Usable as an input? |
|---|---|---|---|

Rate each one **Solved**, **Partly** or **Unsolved**, and give a reason.

## 4. Decide
- **Build** what is unsolved, or done badly in a way pilots feel.
- **Integrate** what is solved and public: take NBM, LAMP or a NOTAM feed as data, and spend the effort on what the planner does with it.
- **Skip** what is solved and private, unless the planner can do it clearly better for its own users. Say why it would be better.

## 5. Lead with the differentiators
The planner already does things no other app was found doing. For example, it picks visual checkpoints off the chart for a route and ranks how easy each is to spot (a search on 2026-10-05 found no other app that does this). New proposals should deepen that kind of gap before they chase parity.

## Report
Give the job, the survey table with its date, the decision, and the smallest version worth building first.
