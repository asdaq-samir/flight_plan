//! Distances as wingtip.geo has them: great circles on a sphere of 3,440.065
//! nm, the approximation flight computers use (wingtip.geo's own docstring),
//! which PROJ works out for the planner and this for the phones. The
//! central angle by the atan2 form of Vincenty's formula for a sphere,
//! well-conditioned at every distance, so the two agree to a few
//! micrometres.

/// wingtip.geo's EARTH_RADIUS_NM.
pub const EARTH_RADIUS_NM: f64 = 3440.065;

/// The great-circle distance in nautical miles between two points in degrees.
pub fn distance_nm(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dl = (lon2 - lon1).to_radians();
    let (s1, c1) = p1.sin_cos();
    let (s2, c2) = p2.sin_cos();
    let (sd, cd) = dl.sin_cos();
    let y = ((c2 * sd).powi(2) + (c1 * s2 - s1 * c2 * cd).powi(2)).sqrt();
    let x = s1 * s2 + c1 * c2 * cd;
    EARTH_RADIUS_NM * y.atan2(x)
}

/// The initial great-circle bearing from point one to point two, degrees
/// 0 to 360 true (wingtip.geo.bearing_deg, PROJ's forward azimuth on the same
/// sphere). Zero for two points that coincide, as wingtip.geo answers: PROJ's
/// own 180 would give a zero-length leg a due-south course.
pub fn bearing_deg(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    if distance_nm(lat1, lon1, lat2, lon2) == 0.0 {
        return 0.0;
    }
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dl = (lon2 - lon1).to_radians();
    let y = dl.sin() * p2.cos();
    let x = p1.cos() * p2.sin() - p1.sin() * p2.cos() * dl.cos();
    py_mod(y.atan2(x).to_degrees(), 360.0)
}

/// Where a great circle from a point on a true bearing reaches `nm` out,
/// (lat, lon) in degrees, the longitude within -180 to 180: the web's
/// lib/geo destination, written as it is (`deg * PI / 180`).
pub fn destination(lat: f64, lon: f64, bearing: f64, nm: f64) -> (f64, f64) {
    use std::f64::consts::PI;
    let d = nm / EARTH_RADIUS_NM;
    let b = bearing * PI / 180.0;
    let (lat1, lon1) = (lat * PI / 180.0, lon * PI / 180.0);
    let lat2 = (lat1.sin() * d.cos() + lat1.cos() * d.sin() * b.cos()).asin();
    let lon2 = lon1 + (b.sin() * d.sin() * lat1.cos()).atan2(d.cos() - lat1.sin() * lat2.sin());
    (lat2 * 180.0 / PI, (lon2 * 180.0 / PI + 540.0) % 360.0 - 180.0)
}

/// How far apart two directions are, degrees 0 to 180, either way round
/// the compass (358 is 4 from 002): wingtip.geo.angle_between.
pub fn angle_between(a: f64, b: f64) -> f64 {
    (py_mod(a - b + 180.0, 360.0) - 180.0).abs()
}

/// Python's % on floats, which the planner's figures are written in: the
/// remainder takes the divisor's sign, and a zero one is +0 for a
/// positive divisor (CPython's float_rem).
pub fn py_mod(a: f64, m: f64) -> f64 {
    let r = a % m;
    if r == 0.0 {
        0.0_f64.copysign(m)
    } else if (r < 0.0) != (m < 0.0) {
        r + m
    } else {
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distances_are_vfr_geos() {
        // pyproj.Geod(a=3440.065, f=0).inv, as wingtip.geo.distance_nm: O'Hare
        // to Midway, Duluth to St Louis.
        let ord_mdw = distance_nm(41.9786, -87.9048, 41.7868, -87.7522);
        assert!((ord_mdw - 13.384_450_662_612_632).abs() < 1e-9, "{ord_mdw}");
        let dlh_stl = distance_nm(46.8421, -92.1936, 38.7487, -90.37);
        assert!((dlh_stl - 492.489_160_876_009_75).abs() < 1e-9, "{dlh_stl}");
        assert_eq!(distance_nm(45.0, -93.0, 45.0, -93.0), 0.0);
    }

    #[test]
    fn bearings_and_angles_are_vfr_geos() {
        // pyproj.Geod(a=3440.065, f=0).inv's azimuth, O'Hare to Midway.
        let b = bearing_deg(41.9786, -87.9048, 41.7868, -87.7522);
        assert!((b - 149.308_659_909_716_54).abs() < 1e-9, "{b}");
        assert_eq!(bearing_deg(45.0, -93.0, 45.0, -93.0), 0.0);
        assert!((bearing_deg(42.0, -88.0, 43.0, -88.0) - 0.0).abs() < 1e-12);
        assert_eq!(angle_between(358.0, 2.0), 4.0);
        assert_eq!(angle_between(10.0, 190.0), 180.0);
        assert_eq!(py_mod(-1e-20, 360.0), 360.0);
        assert_eq!(py_mod(-30.0, 360.0), 330.0);
    }
}
