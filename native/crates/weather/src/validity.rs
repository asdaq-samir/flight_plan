//! When a weather report stops counting, at the owner's rule for the
//! phones with no signal (2026-11-02: "plan with offline weather as long
//! as it is not expired"): each product only inside its own valid time,
//! an expired one left out of the figures, and the plan says so. Times
//! are Unix seconds, UTC.

/// What a report is, for its valid time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Product {
    /// A routine METAR: issued every hour (AIM 7-1-28's key, "METAR-hourly";
    /// AC 00-45H, Aviation Weather Services, its METAR section; the Federal
    /// Meteorological Handbook No. 1, ch. 2, routine observations), so it
    /// counts until the next routine report is due an hour after it was
    /// observed. Past that the screens call it an old report (the web's
    /// Observed, through the `weather_in_force` call).
    Metar,
    /// A SPECI: issued between the routine reports when the weather
    /// changes (FMH-1 ch. 2, special observations). It changes nothing about when the hour's
    /// routine report is due: it counts until that same time.
    Speci,
    /// A TAF: for its valid period, the hours its header gives (AC
    /// 00-45H, its TAF section).
    Taf,
    /// The FB winds and temperatures aloft: for the FOR USE window its
    /// header gives (AC 00-45H, its winds and temperatures aloft section).
    WindsAloft,
    /// An AIRMET, a SIGMET or a G-AIRMET snapshot: for its valid time
    /// (AC 00-45H, its SIGMET, AIRMET and G-AIRMET sections).
    Advisory,
}

/// A routine report's interval (FMH-1 ch. 2).
pub const ROUTINE_INTERVAL_S: i64 = 3600;

/// When a report stops counting. A METAR and a SPECI take the time they
/// were observed and, for a SPECI, the last routine report's time where
/// it is known; the others take the end of the valid time their header
/// gives (`valid_to`). None where nothing says (a forecast with no
/// valid time is not one to plan on).
pub fn expires_at(product: Product, observed: Option<i64>, last_routine: Option<i64>, valid_to: Option<i64>) -> Option<i64> {
    match product {
        Product::Metar => observed.map(|t| t + ROUTINE_INTERVAL_S),
        Product::Speci => match (last_routine, observed) {
            // The routine report after the last one, whenever the SPECI
            // came between them; one an hour or more after it is late.
            (Some(r), Some(o)) if o >= r => Some(r + ROUTINE_INTERVAL_S * (1 + (o - r) / ROUTINE_INTERVAL_S)),
            // Not known: the hour after it, at the latest the routine due.
            (_, Some(o)) => Some(o + ROUTINE_INTERVAL_S),
            _ => None,
        },
        Product::Taf | Product::WindsAloft | Product::Advisory => valid_to,
    }
}

/// Whether a report still counts at `now`: before it expires, and, for
/// a forecast, from when its valid time starts (`valid_from`) -- a TAF's
/// later hours are not today's weather.
pub fn in_force(product: Product, now: i64, observed: Option<i64>, last_routine: Option<i64>,
                valid_from: Option<i64>, valid_to: Option<i64>) -> bool {
    let Some(end) = expires_at(product, observed, last_routine, valid_to) else { return false };
    let started = match product {
        Product::Metar | Product::Speci => true,
        _ => valid_from.is_none_or(|from| now >= from),
    };
    started && now < end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_metar_counts_for_the_hour_after_it_was_observed() {
        assert_eq!(expires_at(Product::Metar, Some(1_000), None, None), Some(4_600));
        assert!(in_force(Product::Metar, 4_599, Some(1_000), None, None, None));
        assert!(!in_force(Product::Metar, 4_600, Some(1_000), None, None, None));
    }

    #[test]
    fn a_speci_lasts_only_until_the_routine_report_is_due() {
        // Routine at 0, a SPECI at 1,200 s: the next routine is still due at 3,600.
        assert_eq!(expires_at(Product::Speci, Some(1_200), Some(0), None), Some(3_600));
        // A SPECI after a missed routine report: the one after that.
        assert_eq!(expires_at(Product::Speci, Some(4_000), Some(0), None), Some(7_200));
    }

    #[test]
    fn a_forecast_counts_only_inside_its_valid_time() {
        assert!(!in_force(Product::Taf, 99, None, None, Some(100), Some(200)));
        assert!(in_force(Product::Taf, 150, None, None, Some(100), Some(200)));
        assert!(!in_force(Product::Taf, 200, None, None, Some(100), Some(200)));
        assert!(!in_force(Product::WindsAloft, 150, None, None, None, None));
    }
}
