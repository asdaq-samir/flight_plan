//! Distances as vfr.geo has them: great circles on a sphere of 3,440.065
//! nm, the approximation flight computers use (vfr.geo's own docstring),
//! which PROJ works out for the planner and this for the phones. The
//! central angle by the atan2 form of Vincenty's formula for a sphere,
//! well-conditioned at every distance, so the two agree to a few
//! micrometres.

/// vfr.geo's EARTH_RADIUS_NM.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distances_are_vfr_geos() {
        // pyproj.Geod(a=3440.065, f=0).inv, as vfr.geo.distance_nm: O'Hare
        // to Midway, Duluth to St Louis.
        let ord_mdw = distance_nm(41.9786, -87.9048, 41.7868, -87.7522);
        assert!((ord_mdw - 13.384_450_662_612_632).abs() < 1e-9, "{ord_mdw}");
        let dlh_stl = distance_nm(46.8421, -92.1936, 38.7487, -90.37);
        assert!((dlh_stl - 492.489_160_876_009_75).abs() < 1e-9, "{dlh_stl}");
        assert_eq!(distance_nm(45.0, -93.0, 45.0, -93.0), 0.0);
    }
}
