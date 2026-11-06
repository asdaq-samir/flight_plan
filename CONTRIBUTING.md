# Contributing

Wingtip Maps is a personal project, so most changes come from its owner and
from the Claude sessions working for them. The same steps apply to anyone.

## Run it

Docker is the only thing to install: every service builds its own image.

```bash
docker compose up webapp          # the app at http://localhost:8080/app
```

The two briefing agents, `nav-log-agent` and `crewai-agent`, call Claude and
need an `ANTHROPIC_API_KEY` of your own:
`docker compose --profile ai up`. The full setup is in
[docs/README.md](docs/README.md#getting-started).

## Where a change goes

- **Aviation rules and figures** (altitudes, winds, fuel, weather minimums,
  Go / No-Go, holds, procedures) live once, in the Rust engine in
  [`native/engine`](native/engine). Every app asks the engine by name; a rule
  copied into a component, a view or a route handler is a bug.
- **Each app** ([`web`](web), [`ios`](ios), [`android`](android)) gets the
  data, keeps the state and draws the screen.
- Every aviation figure or rule names its source in a comment beside the
  code: the 14 CFR part and section, the AIM paragraph or the FAA data set.

## Check it

Run the checks for the part you changed, from that directory:

| Changed | Run |
|---|---|
| `web/` | `npm run types && npx tsc --noEmit && npx eslint . && npx vitest run` |
| `planning-service/`, other Python services | `ruff check app tests && pytest tests/` |
| `src/wingtip`, `tests/` | `ruff check src/wingtip tests && pytest tests/` (repo root) |
| `native/` | `maturin build -m native/Cargo.toml`, install the wheel, then `pytest tests/test_native.py` |
| `springboot-app/` | `mvn -B test` (needs Docker, for Testcontainers) |
| `ios/`, `android/` | CI only |

Python wants `pip install -r requirements-dev.txt` in that directory first.
A changed API changes its OpenAPI document too (`python -m app.openapi` in
planning-service, `WRITE_OPENAPI=1 mvn -B test` in springboot-app), and then
`npm run types` in `web`. The browser tests in `web/e2e` need the whole stack
and run in CI.

## Send it

1. Branch from `main` as `claude/<topic>` (or your own name), and open a pull
   request to `main`.
2. CI and an automated review run on it. It merges by itself once the
   "CI passed" check is green, and the branch is deleted.
3. Never push to `main` and never force-push. To bring a branch up to date,
   merge `main` into it.

A commit message is a paragraph: what changed for the pilot or the
developer, why, and the evidence (a test, a measurement).

## Never commit

- anything under `data/labels/` or `data/processed/`;
- `.env`, certificates or keys.

Stage files by name rather than with `git add -A`.

## Security

Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says, not in
an issue.
