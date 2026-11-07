"""The planner's knobs from the environment. Every variable is declared
once, typed, in wingtip.config's Settings (the planner's and wingtip's
together, since the planner runs wingtip in-process); this module is
where `app.main` (which acts on them) and the status endpoint (which
reports them) take them from without importing each other."""
from wingtip.config import Settings, SettingsError, get_settings  # noqa: F401  (re-exported for the app)

# The chart cycle refresh (see app.chart_refresh): the window on the container's
# clock inside which a new cycle's render may start, "HH:MM-HH:MM" or
# blank for any time, and how many render processes it gets.
CHARTS_REFRESH_WINDOW = get_settings().charts_refresh_window
CHARTS_REFRESH_WORKERS = get_settings().charts_refresh_workers
