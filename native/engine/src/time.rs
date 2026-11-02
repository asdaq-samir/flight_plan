//! UTC dates as Unix seconds, for the weather products' day-and-hour
//! times, with no crate: Howard Hinnant's days-from-civil algorithm
//! (proleptic Gregorian, the calendar UTC is kept in).

pub const DAY_S: i64 = 86_400;

/// Days since 1970-01-01 of a date.
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date of a day since 1970-01-01: (year, month, day).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn days_in_month(year: i64, month: u32) -> u32 {
    let next = if month == 12 { days_from_civil(year + 1, 1, 1) } else { days_from_civil(year, month + 1, 1) };
    (next - days_from_civil(year, month, 1)) as u32
}

/// A day of the month at an hour and minute (hour 24 the next midnight),
/// in the month -- this one, the one before or the one after `near` --
/// that puts it nearest `near`, as the products give the day alone.
/// None where no such month has the day.
pub fn nearest_day(near: i64, day: u32, hour: u32, minute: u32) -> Option<i64> {
    let (y, m, _) = civil_from_days(near.div_euclid(DAY_S));
    let mut best: Option<i64> = None;
    for step in [0i64, -1, 1] {
        let months = y * 12 + m as i64 - 1 + step;
        let (yy, mm) = (months.div_euclid(12), (months.rem_euclid(12) + 1) as u32);
        if day == 0 || day > days_in_month(yy, mm) || hour > 24 || minute > 59 {
            continue;
        }
        let t = days_from_civil(yy, mm, day) * DAY_S + hour as i64 * 3600 + minute as i64 * 60;
        if best.is_none_or(|b| (t - near).abs() < (b - near).abs()) {
            best = Some(t);
        }
    }
    best
}

/// Unix seconds as ISO 8601 UTC, "2026-11-02T14:00:00Z".
pub fn iso(t: i64) -> String {
    let (y, m, d) = civil_from_days(t.div_euclid(DAY_S));
    let s = t.rem_euclid(DAY_S);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", s / 3600, s % 3600 / 60, s % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_the_calendar() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(iso(1_793_628_000), "2026-11-02T14:00:00Z");
        for z in -800_000..800_000i64 {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        // The 31st near the 1st of a 30-day month is the month before's.
        let nov1 = days_from_civil(2026, 11, 1) * DAY_S;
        assert_eq!(nearest_day(nov1, 31, 12, 0), Some(days_from_civil(2026, 10, 31) * DAY_S + 12 * 3600));
    }
}
