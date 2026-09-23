"""The planner's own knobs from the environment, in one place both
`app.main` (which acts on them) and the status endpoint (which
reports them) can import without importing each other."""
import os

# The chart cycle refresh (see app.chart_refresh): the window on the container's
# clock inside which a new cycle's render may start, "HH:MM-HH:MM" or
# blank for any time, and how many render processes it gets.
CHARTS_REFRESH_WINDOW = os.environ.get("CHARTS_REFRESH_WINDOW", "01:00-06:00").strip()
CHARTS_REFRESH_WORKERS = int(os.environ.get("CHARTS_REFRESH_WORKERS", "1"))
