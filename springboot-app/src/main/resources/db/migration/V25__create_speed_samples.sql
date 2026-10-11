-- How fast the web app is, kept so its trend can be seen (SpeedController).
-- "field" samples come from pilots' browsers: Core Web Vitals and a few
-- timings, with the page, the kind of device and the app's build, and
-- nothing of the pilot's -- no account, no address, no route, no
-- position. "lab" samples come from the nightly measurement in CI, with
-- the commit measured as the version. A sample is kept 400 days.
CREATE TABLE speed_samples (
    id BIGSERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source VARCHAR(5) NOT NULL CHECK (source IN ('field', 'lab')),
    metric VARCHAR(40) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    page VARCHAR(40) NOT NULL,
    device VARCHAR(10) NOT NULL CHECK (device IN ('phone', 'tablet', 'desktop')),
    version VARCHAR(40) NOT NULL
);

CREATE INDEX speed_samples_recorded_at ON speed_samples (recorded_at);
