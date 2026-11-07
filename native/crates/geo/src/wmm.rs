//! Magnetic variation from the World Magnetic Model (WMM-2025, NOAA NCEI
//! and the British Geological Survey, valid 2025.0 to 2030.0), worked
//! out as wingtip.magnetic's pygeomag does it -- the model's own spherical
//! harmonic sum to degree and order 12, its coefficients the file NOAA
//! publishes (WMM.COF, public domain), copied here so the phone has the
//! same variation the planner and the sectional's isogonic lines use.
//! Positive east, negative west: magnetic = true - variation.

/// The model's epoch and its five-year life (the WMM report, 2025).
pub const EPOCH: f64 = 2025.0;
pub const LIFE_END: f64 = 2030.0;
const MAXORD: usize = 12;
const SIZE: usize = MAXORD + 1;

/// (n, m, g, h, g's yearly change, h's), nT and nT a year, as WMM.COF
/// lists them.
#[rustfmt::skip]
const COEFFICIENTS: [(usize, usize, f64, f64, f64, f64); 90] = [
    (1, 0, -29351.8, 0.0, 12.0, 0.0),
    (1, 1, -1410.8, 4545.4, 9.7, -21.5),
    (2, 0, -2556.6, 0.0, -11.6, 0.0),
    (2, 1, 2951.1, -3133.6, -5.2, -27.7),
    (2, 2, 1649.3, -815.1, -8.0, -12.1),
    (3, 0, 1361.0, 0.0, -1.3, 0.0),
    (3, 1, -2404.1, -56.6, -4.2, 4.0),
    (3, 2, 1243.8, 237.5, 0.4, -0.3),
    (3, 3, 453.6, -549.5, -15.6, -4.1),
    (4, 0, 895.0, 0.0, -1.6, 0.0),
    (4, 1, 799.5, 278.6, -2.4, -1.1),
    (4, 2, 55.7, -133.9, -6.0, 4.1),
    (4, 3, -281.1, 212.0, 5.6, 1.6),
    (4, 4, 12.1, -375.6, -7.0, -4.4),
    (5, 0, -233.2, 0.0, 0.6, 0.0),
    (5, 1, 368.9, 45.4, 1.4, -0.5),
    (5, 2, 187.2, 220.2, 0.0, 2.2),
    (5, 3, -138.7, -122.9, 0.6, 0.4),
    (5, 4, -142.0, 43.0, 2.2, 1.7),
    (5, 5, 20.9, 106.1, 0.9, 1.9),
    (6, 0, 64.4, 0.0, -0.2, 0.0),
    (6, 1, 63.8, -18.4, -0.4, 0.3),
    (6, 2, 76.9, 16.8, 0.9, -1.6),
    (6, 3, -115.7, 48.8, 1.2, -0.4),
    (6, 4, -40.9, -59.8, -0.9, 0.9),
    (6, 5, 14.9, 10.9, 0.3, 0.7),
    (6, 6, -60.7, 72.7, 0.9, 0.9),
    (7, 0, 79.5, 0.0, -0.0, 0.0),
    (7, 1, -77.0, -48.9, -0.1, 0.6),
    (7, 2, -8.8, -14.4, -0.1, 0.5),
    (7, 3, 59.3, -1.0, 0.5, -0.8),
    (7, 4, 15.8, 23.4, -0.1, 0.0),
    (7, 5, 2.5, -7.4, -0.8, -1.0),
    (7, 6, -11.1, -25.1, -0.8, 0.6),
    (7, 7, 14.2, -2.3, 0.8, -0.2),
    (8, 0, 23.2, 0.0, -0.1, 0.0),
    (8, 1, 10.8, 7.1, 0.2, -0.2),
    (8, 2, -17.5, -12.6, 0.0, 0.5),
    (8, 3, 2.0, 11.4, 0.5, -0.4),
    (8, 4, -21.7, -9.7, -0.1, 0.4),
    (8, 5, 16.9, 12.7, 0.3, -0.5),
    (8, 6, 15.0, 0.7, 0.2, -0.6),
    (8, 7, -16.8, -5.2, -0.0, 0.3),
    (8, 8, 0.9, 3.9, 0.2, 0.2),
    (9, 0, 4.6, 0.0, -0.0, 0.0),
    (9, 1, 7.8, -24.8, -0.1, -0.3),
    (9, 2, 3.0, 12.2, 0.1, 0.3),
    (9, 3, -0.2, 8.3, 0.3, -0.3),
    (9, 4, -2.5, -3.3, -0.3, 0.3),
    (9, 5, -13.1, -5.2, 0.0, 0.2),
    (9, 6, 2.4, 7.2, 0.3, -0.1),
    (9, 7, 8.6, -0.6, -0.1, -0.2),
    (9, 8, -8.7, 0.8, 0.1, 0.4),
    (9, 9, -12.9, 10.0, -0.1, 0.1),
    (10, 0, -1.3, 0.0, 0.1, 0.0),
    (10, 1, -6.4, 3.3, 0.0, 0.0),
    (10, 2, 0.2, 0.0, 0.1, -0.0),
    (10, 3, 2.0, 2.4, 0.1, -0.2),
    (10, 4, -1.0, 5.3, -0.0, 0.1),
    (10, 5, -0.6, -9.1, -0.3, -0.1),
    (10, 6, -0.9, 0.4, 0.0, 0.1),
    (10, 7, 1.5, -4.2, -0.1, 0.0),
    (10, 8, 0.9, -3.8, -0.1, -0.1),
    (10, 9, -2.7, 0.9, -0.0, 0.2),
    (10, 10, -3.9, -9.1, -0.0, -0.0),
    (11, 0, 2.9, 0.0, 0.0, 0.0),
    (11, 1, -1.5, 0.0, -0.0, -0.0),
    (11, 2, -2.5, 2.9, 0.0, 0.1),
    (11, 3, 2.4, -0.6, 0.0, -0.0),
    (11, 4, -0.6, 0.2, 0.0, 0.1),
    (11, 5, -0.1, 0.5, -0.1, -0.0),
    (11, 6, -0.6, -0.3, 0.0, -0.0),
    (11, 7, -0.1, -1.2, -0.0, 0.1),
    (11, 8, 1.1, -1.7, -0.1, -0.0),
    (11, 9, -1.0, -2.9, -0.1, 0.0),
    (11, 10, -0.2, -1.8, -0.1, 0.0),
    (11, 11, 2.6, -2.3, -0.1, 0.0),
    (12, 0, -2.0, 0.0, 0.0, 0.0),
    (12, 1, -0.2, -1.3, 0.0, -0.0),
    (12, 2, 0.3, 0.7, -0.0, 0.0),
    (12, 3, 1.2, 1.0, -0.0, -0.1),
    (12, 4, -1.3, -1.4, -0.0, 0.1),
    (12, 5, 0.6, -0.0, -0.0, -0.0),
    (12, 6, 0.6, 0.6, 0.1, -0.0),
    (12, 7, 0.5, -0.1, -0.0, -0.0),
    (12, 8, -0.1, 0.8, 0.0, 0.0),
    (12, 9, -0.4, 0.1, 0.0, -0.0),
    (12, 10, -0.2, -1.0, -0.1, -0.0),
    (12, 11, -1.3, 0.1, -0.0, 0.0),
    (12, 12, -0.7, 0.2, -0.1, -0.1),
];

/// The coefficients unnormalized once (pygeomag's `_load_coefficients`):
/// c and its yearly change cd, the Schmidt factors' running products p,
/// and the recursion's k.
struct Model {
    c: [[f64; SIZE]; SIZE],
    cd: [[f64; SIZE]; SIZE],
    snorm: [f64; SIZE * SIZE],
    k: [[f64; SIZE]; SIZE],
    fn_: [f64; SIZE],
    fm: [f64; SIZE],
}

fn model() -> &'static Model {
    static MODEL: std::sync::OnceLock<Model> = std::sync::OnceLock::new();
    MODEL.get_or_init(|| {
        let mut c = [[0.0; SIZE]; SIZE];
        let mut cd = [[0.0; SIZE]; SIZE];
        let mut snorm = [0.0; SIZE * SIZE];
        let mut k = [[0.0; SIZE]; SIZE];
        let mut fn_ = [0.0; SIZE];
        let mut fm = [0.0; SIZE];
        for &(n, m, g, h, dg, dh) in COEFFICIENTS.iter() {
            c[m][n] = g;
            cd[m][n] = dg;
            if m != 0 {
                c[n][m - 1] = h;
                cd[n][m - 1] = dh;
            }
        }
        // Schmidt semi-normalized to unnormalized, as the WMM's own C does.
        snorm[0] = 1.0;
        for n in 1..=MAXORD {
            snorm[n] = snorm[n - 1] * (2 * n - 1) as f64 / n as f64;
            let mut j = 2.0;
            for m in 0..=n {
                let (ni, mi) = (n as i64, m as i64);
                k[m][n] = ((ni - 1) * (ni - 1) - mi * mi) as f64 / ((2 * ni - 1) * (2 * ni - 3)) as f64;
                if m > 0 {
                    let flnmj = ((n - m + 1) as f64 * j) / (n + m) as f64;
                    snorm[n + m * SIZE] = snorm[n + (m - 1) * SIZE] * flnmj.sqrt();
                    j = 1.0;
                    c[n][m - 1] *= snorm[n + m * SIZE];
                    cd[n][m - 1] *= snorm[n + m * SIZE];
                }
                c[m][n] *= snorm[n + m * SIZE];
                cd[m][n] *= snorm[n + m * SIZE];
            }
            fn_[n] = (n + 1) as f64;
            fm[n] = n as f64;
        }
        k[1][1] = 0.0;
        Model { c, cd, snorm, k, fn_, fm }
    })
}

/// A day as the model's decimal year: 2026.5 is mid-2026 (wingtip.magnetic's
/// `_decimal_year`).
pub fn decimal_year(year: i32, day_of_year: u32, days_in_year: u32) -> f64 {
    year as f64 + (day_of_year - 1) as f64 / days_in_year as f64
}

/// The variation in degrees, east positive, at a point on the ellipsoid
/// for a decimal year. A year outside the model's life is held at its
/// nearest edge, as wingtip.magnetic holds it: the variation drifts a
/// fraction of a degree a year, far closer than none.
pub fn declination(lat: f64, lon: f64, year: f64) -> f64 {
    let year = year.clamp(EPOCH, LIFE_END - 1e-6);
    let md = model();
    let mut p = md.snorm;
    let mut tc = [[0.0; SIZE]; SIZE];
    let mut dp = [[0.0; SIZE]; SIZE];
    let mut sp = [0.0; SIZE];
    let mut cp = [0.0; SIZE];
    let mut pp = [0.0; SIZE];
    sp[0] = 0.0;
    cp[0] = 1.0;
    pp[0] = 1.0;
    // WGS-84's axes and the model's reference radius, km (the WMM report).
    let a = 6378.137_f64;
    let b = 6356.7523142_f64;
    let re = 6371.2_f64;
    let (a2, b2) = (a * a, b * b);
    let c2 = a2 - b2;
    let (a4, b4) = (a2 * a2, b2 * b2);
    let c4 = a4 - b4;
    let alt = 0.0_f64;
    let dt = year - EPOCH;
    let (rlon, rlat) = (lon.to_radians(), lat.to_radians());
    let (srlon, srlat, crlon, crlat) = (rlon.sin(), rlat.sin(), rlon.cos(), rlat.cos());
    let (srlat2, crlat2) = (srlat * srlat, crlat * crlat);
    sp[1] = srlon;
    cp[1] = crlon;
    // Geodetic to spherical coordinates.
    let q = (a2 - c2 * srlat2).sqrt();
    let q1 = alt * q;
    let q2 = ((q1 + a2) / (q1 + b2)) * ((q1 + a2) / (q1 + b2));
    let ct = srlat / (q2 * crlat2 + srlat2).sqrt();
    let st = (1.0 - ct * ct).sqrt();
    let r2 = alt * alt + 2.0 * q1 + (a4 - c4 * srlat2) / (q * q);
    let r = r2.sqrt();
    let d = (a2 * crlat2 + b2 * srlat2).sqrt();
    let ca = (alt + d) / r;
    let sa = c2 * crlat * srlat / (r * d);
    for m in 2..=MAXORD {
        sp[m] = sp[1] * cp[m - 1] + cp[1] * sp[m - 1];
        cp[m] = cp[1] * cp[m - 1] - sp[1] * sp[m - 1];
    }
    let aor = re / r;
    let mut ar = aor * aor;
    let (mut br, mut bt, mut bp, mut bpp) = (0.0, 0.0, 0.0, 0.0);
    for n in 1..=MAXORD {
        ar *= aor;
        for m in 0..=n {
            // The associated Legendre functions and their derivatives by
            // recursion.
            if n == m {
                p[n + m * SIZE] = st * p[n - 1 + (m - 1) * SIZE];
                dp[m][n] = st * dp[m - 1][n - 1] + ct * p[n - 1 + (m - 1) * SIZE];
            } else if n == 1 && m == 0 {
                p[n + m * SIZE] = ct * p[n - 1 + m * SIZE];
                dp[m][n] = ct * dp[m][n - 1] - st * p[n - 1 + m * SIZE];
            } else if n > 1 && n != m {
                if m + 2 > n {
                    p[n - 2 + m * SIZE] = 0.0;
                    dp[m][n - 2] = 0.0;
                }
                p[n + m * SIZE] = ct * p[n - 1 + m * SIZE] - md.k[m][n] * p[n - 2 + m * SIZE];
                dp[m][n] = ct * dp[m][n - 1] - st * p[n - 1 + m * SIZE] - md.k[m][n] * dp[m][n - 2];
            }
            // The coefficients at the year.
            tc[m][n] = md.c[m][n] + dt * md.cd[m][n];
            if m != 0 {
                tc[n][m - 1] = md.c[n][m - 1] + dt * md.cd[n][m - 1];
            }
            let par = ar * p[n + m * SIZE];
            let (temp1, temp2) = if m == 0 {
                (tc[m][n] * cp[m], tc[m][n] * sp[m])
            } else {
                (tc[m][n] * cp[m] + tc[n][m - 1] * sp[m], tc[m][n] * sp[m] - tc[n][m - 1] * cp[m])
            };
            bt -= ar * temp1 * dp[m][n];
            bp += md.fm[m] * temp2 * par;
            br += md.fn_[n] * temp1 * par;
            // At a geographic pole.
            if st == 0.0 && m == 1 {
                pp[n] = if n == 1 { pp[n - 1] } else { ct * pp[n - 1] - md.k[m][n] * pp[n - 2] };
                bpp += md.fm[m] * temp2 * ar * pp[n];
            }
        }
    }
    bp = if st == 0.0 { bpp } else { bp / st };
    let bx = -bt * ca - br * sa;
    let by = bp;
    by.atan2(bx).to_degrees()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_space_needle_as_pygeomag_documents_it() {
        // pygeomag's own doctest: 15.065629638512593 at 2025.25.
        assert!((declination(47.6205, -122.3493, 2025.25) - 15.065629638512593).abs() < 1e-9);
    }
}
