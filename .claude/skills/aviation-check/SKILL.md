---
name: aviation-check
description: Make every aviation figure and rule the planner states or computes right and sourced. That covers altitudes, cloud clearances, weather minimums, airspace, fuel, oxygen, traffic patterns, magnetic variation, and data from NASR, obstacles, charts and weather products. Use when writing or reviewing code that encodes a regulation, an AIM procedure, a handbook figure or an FAA data set, and when a pilot-facing number looks off. A wrong figure here is a safety defect, not a style issue.
---

# Aviation check

## 1. Find the primary source
Never cite from memory. Fetch the current text and quote the exact words that decide the case:
- **Regulations:** eCFR, Title 14, current version: https://www.ecfr.gov/current/title-14
- **AIM, current edition and changes:** https://www.faa.gov/air_traffic/publications/atpubs/aim_html/
- **Advisory circulars and handbooks:** the FAA's own pages, for example AC 90-66C or FAA-H-8083-25C, the Pilot's Handbook of Aeronautical Knowledge.
- **Data:** the FAA data set's own documentation for NASR (airports, frequencies, airspace), the Digital Obstacle File and the aeronautical charts. Use the publisher's documentation for USGS 3DEP elevations, NOAA's World Magnetic Model and aviationweather.gov products.

Blogs, apps, forums and training material are never the citation. They can point to the source, nothing more.

## 2. Cite it beside the code
Use the repo's form, in a comment that also says why the rule applies here: `14 CFR 91.155(a)`, `AIM 4-3-3`, `AC 90-66C`, `FAA-H-8083-25C`. For data, name the data set and file (`NASR APT_BASE.csv`, `DOF`).

## 3. Pin it with a test
- Use a worked example straight from the source, such as a row of 91.155's table.
- Test both sides of every boundary: 3,000 ft AGL for cruising altitudes, magnetic course 179° against 180°, 10,000 ft MSL, 1,200 ft AGL in Class G, day against night.
- The expected values come from the source, never from the code under test.

## 4. Check units and references at every boundary
- MSL against AGL.
- True against magnetic, and which model epoch and date gave the variation.
- Nautical against statute miles: flight visibility and cloud distances are statute.
- Knots, Zulu against local time, pressure against density altitude, feet against metres in a data set.

## 5. Check currency
- NASR is published on a 28-day cycle and the VFR charts on a 56-day cycle.
- Say which cycle a figure came from, and what the planner does when that cycle has expired.
- Weather and NOTAMs carry their own issue and valid times. Show them and respect them.

## 6. Simplify toward safety, and say so
When the code simplifies a rule, write down the simplification and make sure it errs toward the safer answer. Where the owner has decided how a rule is presented, follow that. For clouds the decision is to warn and never refuse.

## Rules this code already relies on
Verify any of these against the source before changing code that uses it.

| Topic | Source |
|---|---|
| Definitions | 14 CFR 1.1 |
| Pilot in command's authority and responsibility | 14 CFR 91.3 |
| Preflight action | 14 CFR 91.103 |
| Minimum safe altitudes | 14 CFR 91.119 |
| Traffic pattern direction at airports in Class G | 14 CFR 91.126(b) |
| Operating in Class D, C and B airspace | 14 CFR 91.129, 91.130, 91.131 |
| VFR fuel requirements | 14 CFR 91.151 |
| Basic VFR weather minimums | 14 CFR 91.155 |
| VFR cruising altitudes | 14 CFR 91.159 |
| Supplemental oxygen | 14 CFR 91.211 |
| Transponder and altitude reporting (the Mode C veil) | 14 CFR 91.215 |
| ADS-B Out | 14 CFR 91.225 |
| Traffic patterns | AIM 4-3-3 |
| Operations at non-towered airports | AC 90-66C |

Never edit `planning-service/app/detection.py`: a kept read is hashed against it.
