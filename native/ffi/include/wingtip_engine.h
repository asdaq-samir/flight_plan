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
/// What the radio said, read and its places found in the kept packs, as
/// JSON (wingtip_engine::spoken::hear); NULL where heard is NULL.
char *wt_clearance_hear(const char *heard, const char *tail, const uint8_t *const *packs, const size_t *lens, size_t count,
                        const double *near_lat, const double *near_lon, size_t near_count,
                        const char *dep, const char *stops, const char *dest);
void wt_string_free(char *s);

/// The alerts ahead with no network, as the planner's /api/alerts/ahead
/// answers, JSON: count packs (the regions round the airplane), alt_ft
/// NAN where not known, tfrs the kept TFRs a tab-separated line each or
/// NULL, downloaded at tfrs_at (INT64_MIN not known). Free with
/// wt_string_free.
char *wt_ahead(const uint8_t *const *ptrs, const size_t *lens, size_t count, double lat, double lon, double track_deg,
               double gs_kt, double alt_ft, double vs_fpm, int64_t now, const char *tfrs, int64_t tfrs_at);

/// The map's view with no network, each as the planner's in-view endpoint
/// answers it, JSON, from count packs (the regions the box meets) for the
/// box south, west, north, east in degrees. Free with wt_string_free.
/// AirspaceInView: the Class B, C and D reaching into the box, each whole
/// (/api/airspace/in-view); a pack without airspace.attr has ident, the
/// hours and the top's exclusion null and no primary fields.
char *wt_airspace_in_view(const uint8_t *const *ptrs, const size_t *lens, size_t count, double south, double west,
                          double north, double east);
/// AirportsInView: the landing fields inside the box, the biggest first,
/// at most 300 (/api/airports/in-view); flight_category always null (a
/// live METAR's), military null from a pack without OWNERSHIP_TYPE_CODE,
/// kind "other" from one without SIZE.
char *wt_airports_in_view(const uint8_t *const *ptrs, const size_t *lens, size_t count, double south, double west,
                          double north, double east);
/// NavaidsInView: the VORs inside the box by ident, at most 500
/// (/api/navaids/in-view); remarks always empty (NAV_RMK is not in a
/// pack), service_volume and hours null from a pack without ALT_CODE and
/// OPER_HOURS, and no fixes.
char *wt_navaids_in_view(const uint8_t *const *ptrs, const size_t *lens, size_t count, double south, double west,
                         double north, double east);

/// wt_call's answer: ok 1 with the rule's JSON in text, or 0 with what
/// was wrong in words; text freed with wt_string_free either way.
typedef struct {
    int32_t ok;
    char *text;
} WtCalled;
/// The engine's one way in, as the web app and the planner ask it too: a
/// rule by name ("holding", "lost_comms", "diversion", "debrief", ...;
/// native/engine/src/call.rs lists them), its input a JSON object, its
/// answer JSON. name and input NUL-terminated UTF-8.
WtCalled wt_call(const char *name, const char *input);

#ifdef __cplusplus
}
#endif

#endif
