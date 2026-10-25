"""The Brief's Go / No-Go, worked out on the planner for the native app:
the web app's rules (web/src/lib/verdict.ts and the modules it is fed
from -- minimums, icing, frat, airworthiness, takeoffLanding, runwayCheck,
weightBalance, passTimes) ported line for line, with the same words and
the same sources, so the phone shows the planner's answer and computes no
rule of its own (docs/NATIVE.md). The two must change together: each
module names the web file it mirrors, and the tests are the web's cases.

- `verdict`: the seven findings and the line over them.
- `minimums`, `icing`, `frat`, `runways`, `weight_balance`,
  `pass_times`: what each finding is worked out from.
- `words`: how figures and the FAA's words are written, as the web's
  lib/units, lib/advisories and features/plan/format write them.

app.routers.gonogo assembles their inputs from the planner's own plan and
briefing, and POST /api/go-no-go answers with them."""
