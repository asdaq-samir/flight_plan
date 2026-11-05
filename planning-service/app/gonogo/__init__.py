"""The Brief's Go / No-Go, worked out on the planner for the native app:
the web app's rules (web/src/lib/verdict.ts and the modules it is fed
from -- minimums, icing, frat, airworthiness, takeoffLanding, runwayCheck,
weightBalance, passTimes), with the same words and the same sources, so
the phone shows the planner's answer and computes no rule of its own
(docs/NATIVE.md). The rules themselves are the shared engine's
(wingtip_engine::gonogo, native/engine/src/gonogo), asked by name with
JSON in and out (`ask`, through wingtip_native.call), as the web app asks
them in the browser and the phones through wt_call; these modules keep
their names and dicts and only carry them across. Each module names the
web file it mirrors, and the tests are the web's cases.

- `verdict`: the seven findings and the line over them.
- `minimums`, `icing`, `frat`, `runways`, `weight_balance`,
  `pass_times`: what each finding is worked out from.
- `words`: how figures and the FAA's words are written, as the web's
  lib/units, lib/advisories and features/plan/format write them.

app.routers.gonogo assembles their inputs from the planner's own plan and
briefing, and POST /api/go-no-go answers with them."""
import json

import wingtip_native


def ask(name: str, **given):
    """The engine's rule `name` on the input given (wingtip_engine::call,
    gonogo::calls lists the Go / No-Go's), its answer parsed. Dates and
    datetimes are sent as the planner's JSON sends them."""
    return json.loads(wingtip_native.call(name, json.dumps(given, default=str)))
