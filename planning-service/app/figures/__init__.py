"""The figures four of the web app's pages work out in the browser, worked
out here for the native app, which computes no aviation figure of its own
(docs/NATIVE.md): a flight debriefed against its flown track (lib/debrief,
ACS PA.VI.A), the diversion drill's wind triangle (lib/diversion, ACS
PA.VI.C), a hold's entry and its legs in the wind (lib/holding, AIM 5-3-8),
and the altitude flown on each segment after a two-way radio failure
(lib/lostComms, 14 CFR 91.185). The rules and their words are the engine's
(wingtip_engine::figures, through wingtip_native), which the phones call too
(native/ffi); each module here only carries the dicts across. The web app
keeps its own TypeScript (as app.gonogo and lib/verdict), with the same
words and sources, and the two change together."""
