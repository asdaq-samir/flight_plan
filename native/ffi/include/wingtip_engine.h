// The engine's C functions (native/ffi/src/lib.rs), for the phones. Each
// takes a pack as a pointer and a length kept mapped for the call; a
// string returned is given back with wt_string_free.
#ifndef WINGTIP_ENGINE_H
#define WINGTIP_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// The planner's AirspaceAt for the point as JSON, from a phone's pack;
/// NULL where the bytes are not a pack. ground_ft NAN where not known.
char *wt_airspace_at(const uint8_t *ptr, size_t len, double lat, double lon, double ground_ft);
/// 1 every byte as written, 0 not, -1 no pack.
int32_t wt_pack_verify(const uint8_t *ptr, size_t len);
/// The pack's cycle, "YYYY-MM-DD"; NULL where it is no pack.
char *wt_pack_cycle(const uint8_t *ptr, size_t len);
/// The name of the region whose pack holds a point ("n40w088").
char *wt_region_of(double lat, double lon);
void wt_string_free(char *s);

/// The wind triangle: 1 with the correction (+ right), true heading and
/// groundspeed written out (a pointer may be NULL); 0 where no heading
/// holds the course.
int32_t wt_wind_triangle(double true_course_deg, double tas_kt, double wind_from_deg, double wind_kt,
                         double *wca_deg, double *heading_deg, double *groundspeed_kt);
/// The lowest VFR cruising altitude (14 CFR 91.159) at or above a floor.
double wt_lowest_vfr_altitude(double floor_ft, double magnetic_course_deg);
/// The fuel reserve in minutes (14 CFR 91.151, 91.167).
double wt_reserve_min(int32_t ifr, int32_t night);
/// Density altitude from a pressure altitude and the air's temperature.
double wt_density_altitude_ft(double pressure_altitude_ft, double oat_c);
/// Pressure altitude from a field's elevation and its altimeter setting.
double wt_pressure_altitude_ft(double elevation_ft, double altimeter_inhg);
/// Magnetic variation, east positive, for a decimal year (WMM-2025).
double wt_declination(double lat, double lon, double year);
/// Whether a weather report counts at now (Unix s): kind 0 METAR, 1
/// SPECI, 2 TAF, 3 winds aloft, 4 AIRMET/SIGMET; INT64_MIN not known.
/// 1 counts, 0 not, -1 no such kind.
int32_t wt_weather_in_force(int32_t kind, int64_t now, int64_t observed, int64_t last_routine,
                            int64_t valid_from, int64_t valid_to);

#ifdef __cplusplus
}
#endif

#endif
