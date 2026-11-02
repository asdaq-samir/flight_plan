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
/// 1 where the transmission was said to tail by its call sign, 0 not.
int32_t wt_our_call(const char *heard, const char *tail);
void wt_string_free(char *s);

#ifdef __cplusplus
}
#endif

#endif
