/**
 * Audio panels, headsets and cables, and whether each can bring the
 * airplane's radio to the phone. A phone has no airband receiver, so the
 * radio reaches it only as a microphone. That means the audio panel or
 * headset sending audio over Bluetooth, or a cable. Over Bluetooth an
 * iPhone takes audio in only on the hands-free profile (HFP): Apple calls
 * A2DP "a stereo, output-only profile" and allowBluetoothHFP the option
 * that "makes Bluetooth Hands-Free Profile (HFP) devices available for
 * audio input" (AVFAudio, AVAudioSession.CategoryOptions). So a panel or
 * headset has to put the radio on what it treats as its microphone.
 *
 * Most don't. In a phone call a panel sends the intercom's microphones,
 * and a headset sends its boom mic. A few panels have a recording mode
 * that sends everything the pilot hears. Every entry here comes from its
 * maker's own manual, read on 2026-11-04 and listed in its `sources`.
 * Where a maker documents the audio only to a camera, or not at all, the
 * entry says so ("radio-maybe", confidence "test"). It never guesses that
 * the radio comes in.
 *
 * The Radio card names the live input from its MediaStreamTrack label, so
 * each entry carries patterns for that label: the Bluetooth name its maker
 * documents, and its model as written. In Safari the label is the iOS
 * audio port's name, which is the device's Bluetooth name, and the phone's
 * own microphone is "iPhone Microphone" (WebKit's
 * AVAudioSessionCaptureDevice; Media Capture's label rules). Garmin
 * documents no Bluetooth name for any panel, so its panels are recognised
 * by model number only.
 */

export type GearKind = "panel" | "headset" | "cable";

/** What reaches the phone from it: the radio; only voices (a headset's
 *  boom mic, or the intercom's mics in a panel's phone mode); maybe the
 *  radio (documented only to a camera or a maker's own app, or untested
 *  with a phone); nothing, as it has no Bluetooth audio for a phone. */
export type Gives = "radio" | "voice" | "radio-maybe" | "none";

/** How sure the entry is: the maker's own documents say it; it follows from
 *  a maker's sibling model or a retailer; or only a ground test can tell. */
export type Confidence = "documented" | "likely" | "test";

/** What the app is hearing through the live input. */
export type Hearing = "radio" | "voice" | "phone-mic" | "unknown";

export interface Gear {
  id: string;
  maker: string;
  model: string;
  kind: GearKind;
  /** The name its maker says it shows in the phone's Bluetooth list, "#"
   *  standing for a digit of its serial number. Null where the maker
   *  doesn't say, or where it has no Bluetooth. */
  shows: string | null;
  /** Recognise it in an input's label, case-insensitive. Empty for what
   *  never shows as a Bluetooth input: a panel without Bluetooth, or a
   *  cable, which shows as the phone's own wired or USB port. */
  names: RegExp[];
  gives: Gives;
  /** Short plain sentences a pilot follows, on the ground first. */
  steps: string[];
  /** The one line the Radio card shows while this is the live input. */
  says: string;
  confidence: Confidence;
  /** Where each statement comes from: URL, document and page, when read. */
  sources: string[];
}

const SEEN = "seen 2026-11-04";

// Steps that open every Bluetooth pairing.
const ON_THE_GROUND = "Pair on the ground with the avionics on and the engine off.";
// 47 CFR 22.925: cellular telephones aboard an aircraft "must not be
// operated while such aircraft are airborne" and must be turned off when
// it leaves the ground. Airplane mode does that and keeps Bluetooth.
const AIRPLANE_MODE = "Turn on airplane mode, then turn Bluetooth back on: the phone's cellular radio must stay off in the air.";
// iOS routes to the separate Bluetooth device that connected last ("last
// in wins", Apple's AVAudioSessionCategoryOptions header).
const OTHERS_OFF = "Disconnect AirPods, the car and any other Bluetooth audio: the last one to connect takes the input.";
// A panel's call carries the intercom, not the radio: Garmin's GMA 350c
// guide p.36, PS Engineering's PAR200B and PMA8000BT guides, Avidyne's
// AMX240 manual §3.5 ("The telephone party does not hear ATC").
const NO_CALL = "Never place a phone call through it: a call sends the intercom's microphones, not the radio.";
const GROUND_TEST = "Before relying on it, tune the ATIS with the cabin speaker off and check the words follow it.";
const CABLE = "For the radio, use a recording cable in line with your headset, such as the NFlightCam USB-C cable.";

const pickIn = (what: string) => `In the iPhone's Settings, Bluetooth, pick ${what}.`;

const GARMIN_350C = "https://static.garmin.com/pumac/190-01134-12_L.pdf (GMA 350/350c Pilot's Guide 190-01134-12 Rev. L, June 2017, pp.10-11, 18-24, 36-38; " + SEEN + ")";
const GARMIN_2015 = "https://garmin.com/en-US/newsroom/?p=1681 (Garmin release, 16 July 2015: the GMA 350c series is the 350c, 35c and 350Hc; VIRB XE gets intercom and ATC over Bluetooth; " + SEEN + ")";
const GARMIN_2017 = "https://garmin.com/en-US/newsroom/?p=1409 (Garmin release, 29 March 2017: Bluetooth on the GMA 345, a 3.5 mm jack on the GMA 342, both slide-in for the GMA 340; " + SEEN + ")";
const PSE_450B_PG = "https://www.ps-engineering.com/assets/docs/PMA450B_PG.pdf (PMA450B Pilot Guide 202-450-0600 Rev. 11, April 2025, pp.10-14 (BT1 and BT2 names p.12), 18-24; " + SEEN + ")";
const PSE_450B_IM = "https://www.ps-engineering.com/assets/docs/PMA450B_IM.pdf (PMA450B Installation Manual Rev. 6, June 2023, §2.7.5.3, §3.15; " + SEEN + ")";
const LIGHTSPEED_FLIGHTLINK = "https://rev.lightspeedaviation.com/?p=8117 (Lightspeed FlightLink Support and FAQ, ©2024: cable for Zulu 2, Zulu 3, Tango and Sierra; Bluetooth \"will override the audio cable and create the 'hot mic' scenario using your headset microphone\"; " + SEEN + ")";
const SPORTYS_FAQ = "https://www.sportys.com/blog/bluetooth-in-aviation-headsets-frequently-asked-questions/ (Sporty's, 18 Sep 2025: a Bluetooth aviation headset can't record cockpit audio on a phone; that needs an adapter into the intercom; " + SEEN + ")";

/** The catalogue, in the order labels are matched: where two entries could
 *  take one label, the narrower comes first ("Delta Zulu" before "Zulu 3"). */
export const GEAR: readonly Gear[] = [
  // ---- Garmin panels ----
  {
    // Garmin's statement that a phone app gets the radio over Bluetooth,
    // which the 350Hc's guide repeats: "Bluetooth Recording Mode takes all
    // audio routed to the pilot's headphones (such as radio, music and
    // intercom audio) and also outputs that audio to a paired Bluetooth
    // device", naming "a smart phone or tablet app" and requiring HFP
    // (p.38). It is whatever the
    // pilot hears, so isolating the intercom (pp.19, 21) and taking music
    // and the phone off PILOT in Blue-Select (pp.23-24) leave nearly only
    // the radio; alerts and selected NAV and marker idents still come (p.18).
    id: "garmin-gma-350c",
    maker: "Garmin",
    model: "GMA 350c",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*350\s*c\b/i],
    gives: "radio",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold the panel's small knob for two seconds: the Bluetooth light flashes and the panel can be found for 90 seconds.",
      pickIn("the audio panel"),
      "Once it's connected, press PILOT and the small knob together. PILOT turns blue and you hear \"Bluetooth Recording Mode Enabled\". The panel remembers it for this phone.",
      "For the radio with fewer voices, use Pilot Isolate, and take the blue music and phone off PILOT in Blue-Select.",
      "Selected NAV and marker idents and the airplane's alerts still come through, so deselect NAV and MKR when you're not identifying.",
      NO_CALL,
    ],
    says: "GMA 350c in recording mode: the radio comes in.",
    confidence: "documented",
    sources: [GARMIN_350C],
  },
  {
    // Its own guide has the same recording mode, word for word, naming "a
    // smart phone or tablet app" (p.40). The pairing light is green (p.38).
    id: "garmin-gma-350hc",
    maker: "Garmin",
    model: "GMA 350Hc",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*350\s*Hc\b/i],
    gives: "radio",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold the panel's small knob for two seconds: the Bluetooth light flashes and the panel can be found for 90 seconds.",
      pickIn("the audio panel"),
      "Once it's connected, press PILOT and the small knob together. PILOT turns blue and you hear \"Bluetooth Recording Mode Enabled\". The panel remembers it for this phone.",
      "For the radio with fewer voices, isolate the pilot's intercom and take the blue music and phone off PILOT in Blue-Select.",
      NO_CALL,
    ],
    says: "GMA 350Hc in recording mode: the radio comes in.",
    confidence: "documented",
    sources: [
      "https://static.garmin.com/pumac/190-01134-14_L.pdf (GMA 350H/350Hc Pilot's Guide 190-01134-14 Rev. L, October 2017, pp.38-40; " + SEEN + ")",
      GARMIN_2015,
    ],
  },
  {
    // No Bluetooth: the guide shared with the 350c gives Bluetooth to the
    // 350c only ("BLUETOOTH (GMA 350c ONLY)", p.36).
    id: "garmin-gma-350",
    maker: "Garmin",
    model: "GMA 350",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 350 has no Bluetooth; the GMA 350c does.", CABLE],
    says: "GMA 350: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [GARMIN_350C],
  },
  {
    // Recording Mode sends "pilot headphone audio" over "HFP 1.6 Wide Band
    // Speech", but the guide names only cameras for it; it does tell a
    // phone how to pair, and connects one Bluetooth device at a time
    // (pp.28-29). Garmin makes no "GMA 345c": the 345 is its Bluetooth
    // panel and the 342 has none.
    id: "garmin-gma-345",
    maker: "Garmin",
    model: "GMA 345",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*345\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold TEL (PAIR) for one second: the Bluetooth light flashes and the panel can be found for two minutes.",
      pickIn("the audio panel"),
      "Once it's connected, press TEL (PAIR) and PILOT together: you hear \"Bluetooth Recording Mode Enabled\". It's needed once for each phone.",
      "The panel connects one Bluetooth device at a time, so there's no music while the phone listens.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 345: may send the radio in its recording mode, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-01878-01_d.pdf (GMA 345 Pilot's Guide 190-01878-01 Rev. D, June 2023, pp.24-30; " + SEEN + ")",
      GARMIN_2017,
    ],
  },
  {
    // The G1000 NXi's panel: "If the Audio Panel detects a recording device
    // as the Bluetooth connected source, the PILOT ICS annunciation will
    // turn blue. All audio heard by the Pilot will be recorded." Whether it
    // takes a phone for a recording device isn't said, but the blue light
    // shows the pilot which it did (printed pp.142, 144).
    id: "garmin-gma-1360",
    maker: "Garmin",
    model: "GMA 1360 (G1000 NXi)",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*1360\s*D?\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold the audio panel's small knob for two seconds: the Bluetooth light flashes and the panel can be found for 60 seconds.",
      pickIn("the audio panel"),
      "Once it's connected, press and hold PILOT ICS to turn on Bluetooth recording mode.",
      "If PILOT ICS turns blue, the panel sends everything the pilot hears. If it stays white, the phone gets the intercom, not the radio.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 1360: may send the radio if PILOT ICS is blue, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: ["https://static.garmin.com/pumac/190-02177-03_a.pdf (G1000 NXi Pilot's Guide for the Cessna NAV III 190-02177-03 Rev. A, printed pp.142, 144; " + SEEN + ")"],
  },
  {
    // The G1000's panel before the NXi: 662 pages of its pilot's guide and
    // not one mention of Bluetooth; the GMA 1347 is "NAV/COM digital audio,
    // intercom system and marker beacon controls" (printed p.3).
    id: "garmin-gma-1347",
    maker: "Garmin",
    model: "GMA 1347 (G1000)",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The G1000's GMA 1347 has no Bluetooth.", CABLE],
    says: "GMA 1347: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://static.garmin.com/pumac/190-00498-08_0A_Web.pdf (G1000 Pilot's Guide for the Cessna NAV III 190-00498-08 Rev. A, May 2013, printed p.3; no Bluetooth in its 662 pages; " + SEEN + ")"],
  },
  {
    // "Pilot headphone audio" goes over Bluetooth only to "versions of the
    // Garmin VIRB action camera that support Bluetooth mic audio input";
    // pairing starts from the G3X Touch's Phone & Media tab (pp.116-117).
    id: "garmin-gma-245",
    maker: "Garmin",
    model: "GMA 245 or 245R (G3X)",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*245\s*R?\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "On a G3X Touch, open Audio Panel, then the Phone & Media tab, and touch Pair Device.",
      pickIn("the audio panel"),
      "Garmin documents its headphone audio over Bluetooth only to a VIRB camera, so a phone may get only the intercom.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 245: Garmin sends its audio only to a VIRB camera, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: ["https://static.garmin.com/pumac/190-02472-00_b.pdf (G3X Touch Pilot's Guide for Certified Aircraft 190-02472-00 Rev. B, December 2019, pp.116-118; " + SEEN + ")"],
  },
  {
    // The remote panel under a GTN Xi: the GTN Xi's guide gives its
    // Bluetooth only who hears it, muting and volume (p.2-68), and never
    // names a VIRB; the GMA 35/35c Installation Manual (190-00858-11 Rev. H,
    // p.1-1) has it "connect wirelessly to the VIRB XE", and Garmin's 2015
    // release has the VIRB XE overlay intercom and ATC.
    id: "garmin-gma-35c",
    maker: "Garmin",
    model: "GMA 35c (under a GTN Xi)",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*35\s*c\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      pickIn("the audio panel"),
      "The GTN Xi has no control for a recording link: Garmin documents the cockpit audio only to a VIRB XE camera.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 35c: Garmin sends its audio only to a VIRB camera, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-02327-03_g.pdf (GTN Xi Pilot's Guide 190-02327-03 Rev. G, 2025, p.2-68; " + SEEN + ")",
      GARMIN_2015,
    ],
  },
  {
    // No Bluetooth; its 3.5 mm jack lets "pilots connect a mobile device"
    // as an input (Garmin's 2017 release).
    id: "garmin-gma-342",
    maker: "Garmin",
    model: "GMA 342",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 342 has no Bluetooth, and its 3.5 mm jack takes audio in, not out.", CABLE],
    says: "GMA 342: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [GARMIN_2017],
  },
  {
    // No Bluetooth: its pilot's guide never mentions it, and Garmin made
    // the GMA 345 its Bluetooth slide-in replacement.
    id: "garmin-gma-340",
    maker: "Garmin",
    model: "GMA 340",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 340 has no Bluetooth.", CABLE],
    says: "GMA 340: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [
      "https://www.aircraftspruce.com/catalog/pdf/gma340pilots.pdf (GMA 340 Pilot's Guide 190-00149-10 Rev. C, no Bluetooth in its 12 pages; " + SEEN + ")",
      GARMIN_2017,
    ],
  },
  {
    // No Bluetooth; its face jack is "Music 1/TEL ... External music device
    // or telephone input" (pp.4-5).
    id: "garmin-gma-240",
    maker: "Garmin",
    model: "GMA 240",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 240 has no Bluetooth, and its jack on the face takes music or a phone in, not out.", CABLE],
    says: "GMA 240: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.aircraftspruce.com/catalog/pdf/gma240pilots.pdf (GMA 240 Pilot's Guide 190-00917-00 Rev. A, June 2008, pp.4-5; no Bluetooth in its 12 pages; " + SEEN + ")"],
  },

  // ---- PS Engineering panels ----
  {
    // The second Bluetooth module (BT2) set as a Streamer is the only
    // output found with a COM-only choice: "The output can contain either
    // the audio heard by the pilot (radio, intercom, music, etc.) or only
    // communications radio audio." PS Engineering names GoPro cameras, not
    // phones, and states no Bluetooth profile. As shipped, BT2 shows as
    // "BT2" and the last four digits of the serial (PG p.12), so any panel's
    // BT2 lands here; the line below holds for a PMA450C's BT2 too.
    // Install manual Rev. 6 has the Streamer off at each power-up; Pilot
    // Guide Rev. 11 (S/N W45B2849 and up, v4.122) remembers it. The
    // PMA450A with PS Streamer has the same sentence and menus (its IM
    // §3.15, §3.18.2).
    id: "pse-ps-streamer",
    maker: "PS Engineering",
    model: "PMA450B or PMA450A with PS Streamer",
    kind: "panel",
    shows: "BT2 ####",
    names: [/^BT\s?2\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Only PMA450B 050-450-0601 or -0701, or PMA450A 050-450-0102, -0104 or -0204, have the PS Streamer.",
      "While the panel starts up, hold the lower line-select button to open the setup, and set BT2 to Streamer.",
      "Pair from Radio-ICS, More, Streamer, Config, Pair (Init Pair on older units), then pick BT2 in the iPhone's Settings, Bluetooth. BT1 is off while it pairs.",
      "Set the Streamer's output to Radio, not Headphone, for the COM audio alone.",
      "On older software the Streamer is off at each power-up, so turn it on every flight.",
      GROUND_TEST,
    ],
    says: "BT2 on a PS Engineering panel: may send the radio from a PS Streamer set to Radio, untested with a phone.",
    confidence: "test",
    sources: [
      PSE_450B_PG,
      PSE_450B_IM,
      "https://www.ps-engineering.com/assets/docs/PMA450A_IM.pdf (PMA450A Installation Manual 200-450-0100 Rev. 7, February 2018, §2.7.4.3, §3.15, §3.18.2; " + SEEN + ")",
    ],
  },
  {
    // Without the Streamer its Bluetooth (BT1) is phone and music. As
    // shipped BT1 shows as "BT1" and the serial's last four digits, on the
    // PMA450C too, so the line is worded for either. Phone mode connects
    // the intercom to the phone; COM audio goes to the headsets.
    id: "pse-pma450b",
    maker: "PS Engineering",
    model: "PMA450B",
    kind: "panel",
    shows: "BT1 ####",
    names: [/^BT\s?1\b/i, /\bPMA[\s-]*450\s*B\b/i],
    gives: "voice",
    steps: [
      "Its Bluetooth (BT1) is for phone and music: a phone hears the intercom, not the radio.",
      "PMA450B units 050-450-0601 and -0701 have a PS Streamer, which can send the radio on BT2.",
      CABLE,
      NO_CALL,
    ],
    says: "BT1 on a PS Engineering panel: hears the intercom, not the radio. For the radio, use a PS Streamer or a cable.",
    confidence: "likely",
    sources: [PSE_450B_PG, PSE_450B_IM],
  },
  {
    // Ships named "PMA450A" (IM §2.7.4.3); without the Streamer its
    // Bluetooth is phone and music only.
    id: "pse-pma450a",
    maker: "PS Engineering",
    model: "PMA450A",
    kind: "panel",
    shows: "PMA450A",
    names: [/\bPMA[\s-]*450\s*A\b/i],
    gives: "voice",
    steps: [
      "Its Bluetooth is for phone and music: a phone hears the intercom, not the radio.",
      "PMA450A units 050-450-0102, -0104 and -0204 have a PS Streamer, which can send the radio on BT2.",
      CABLE,
      NO_CALL,
    ],
    says: "PMA450A: hears the intercom, not the radio. For the radio, use a PS Streamer or a cable.",
    confidence: "likely",
    sources: ["https://www.ps-engineering.com/assets/docs/PMA450A_IM.pdf (PMA450A Installation Manual 200-450-0100 Rev. 7, February 2018, §2.7.4.3, §3.15; " + SEEN + ")"],
  },
  {
    // Two Bluetooth inputs (BT1, BT2), no Streamer; the phone hears "any
    // person heard by the pilot on the intercom" (IM §2.11 checkout).
    id: "pse-pma450c",
    maker: "PS Engineering",
    model: "PMA450C",
    kind: "panel",
    shows: "BT1 #### or BT2 ####",
    names: [/\bPMA[\s-]*450\s*C\b/i],
    gives: "voice",
    steps: ["Both its Bluetooth links are inputs for phone and music: a phone hears the intercom, not the radio.", CABLE, NO_CALL],
    says: "PMA450C: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "likely",
    sources: ["https://www.ps-engineering.com/assets/docs/PMA450C_PG.pdf (PMA450C Pilot Guide 202-450-0800 Rev. 3, August 2024, pp.11-15 (BT1 and BT2 names p.12); " + SEEN + ")"],
  },
  {
    // Bluetooth for phone and music, phone mode by intercom mode (PG p.11).
    // From S/N F1256 a wired "CVR Output (J2, Pin 29)" carries "the audio
    // as heard by the pilot, including selected radios" (IM §2.4.15).
    id: "pse-pma8000g",
    maker: "PS Engineering",
    model: "PMA8000G",
    kind: "panel",
    shows: "PMA8000G",
    names: [/\bPMA[\s-]*8000\s*G\b/i],
    gives: "voice",
    steps: [
      "Its Bluetooth is for phone and music: a phone hears the intercom, not the radio.",
      "From serial number F1256 it has a wired output of what the pilot hears (J2 pin 29), which an installer can bring out to a jack.",
      CABLE,
      NO_CALL,
    ],
    says: "PMA8000G: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "likely",
    sources: [
      "https://www.ps-engineering.com/assets/docs/PMA8000G_PG.pdf (PMA8000G Pilot Guide 202-890-0912 Rev. 9, January 2023, pp.9, 11; " + SEEN + ")",
      "https://www.ps-engineering.com/assets/docs/PMA8000G_IM.pdf (PMA8000G Installation Manual 200-890-0912 Rev. 20, November 2025, §2.4.15; " + SEEN + ")",
    ],
  },
  {
    // TEL mode: "The telephone party will not hear ATC communications, and
    // vice versa" (p.6); pairing picks "the PMA8000BT" (p.7).
    id: "pse-pma8000bt",
    maker: "PS Engineering",
    model: "PMA8000BT",
    kind: "panel",
    shows: "PMA8000BT",
    names: [/\bPMA[\s-]*8000\s*BT\b/i],
    gives: "voice",
    steps: ["Its Bluetooth is for phone and music: PS Engineering says the phone does not hear ATC.", CABLE, NO_CALL],
    says: "PMA8000BT: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.ps-engineering.com/assets/docs/PMA8000BT_PG.pdf (PMA8000BT Pilot Guide 202-890-0702 Rev. 11, May 2019, pp.6-7; " + SEEN + ")"],
  },
  {
    // No Bluetooth; its front utility jack takes a phone in TEL mode, where
    // "The telephone party will not hear ATC communications" (IM p.3-2).
    id: "pse-pma8000b",
    maker: "PS Engineering",
    model: "PMA8000B",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The PMA8000B has no Bluetooth, and a phone on its utility jack hears the intercom, not ATC.", CABLE],
    says: "PMA8000B: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.ps-engineering.com/assets/docs/PMA8000B_IM.pdf (PMA8000B Installation Manual 200-890-0101 Rev. 7, April 2018, pp.1-1, 3-2; no Bluetooth in its 40 pages; " + SEEN + ")"],
  },
  {
    // "The telephone party will not hear ATC communications, and vice
    // versa" (p.10); the phone finds "the 'PAR200B'" (p.9).
    id: "pse-par200b",
    maker: "PS Engineering",
    model: "PAR200B",
    kind: "panel",
    shows: "PAR200B",
    names: [/\bPAR[\s-]*200\s*B\b/i],
    gives: "voice",
    steps: ["Its Bluetooth is for phone calls: PS Engineering says the phone does not hear ATC.", CABLE, NO_CALL],
    says: "PAR200B: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.ps-engineering.com/assets/docs/PAR200B_PG.pdf (PAR200B Pilot Guide 202-228-0300 Rev. 2, August 2024, pp.9-10; " + SEEN + ")"],
  },

  // ---- Avidyne ----
  {
    // "The telephone party does not hear ATC communications, and vice
    // versa" (§3.5); "search for the AMX240" (§3.11). Its front 2.5 mm
    // utility jack is an input (§3.10).
    id: "avidyne-amx240",
    maker: "Avidyne",
    model: "AMX240",
    kind: "panel",
    shows: "AMX240",
    names: [/\bAMX[\s-]*240\b/i],
    gives: "voice",
    steps: [
      "Its Bluetooth is for phone and music: Avidyne says the phone does not hear ATC.",
      "Its jack on the face takes audio in, not out.",
      CABLE,
      NO_CALL,
    ],
    says: "AMX240: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.avidyne.com/wp-content/uploads/2025/05/AMX240_200-890-0240.pdf (AMX240 Installation Manual 200-890-0240 Rev. 03, §3.5, §3.10, §3.11; " + SEEN + ")"],
  },

  // ---- Lightspeed headsets ----
  {
    // Shows as "Delta Zulu_####" (UG p.19). Lightspeed's app records "radio
    // and intercom audio" (p.23), but "uses Bluetooth to transfer data and
    // recordings" and records "regardless of what audio device is
    // selected", so it most likely isn't the HFP microphone a browser gets.
    id: "lightspeed-delta-zulu",
    maker: "Lightspeed",
    model: "Delta Zulu",
    kind: "headset",
    shows: "Delta Zulu_####",
    // Not \b at the end: "Zulu_" runs on into the serial's underscore.
    names: [/\bDelta[\s_-]*Zulu(?![a-z])/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Turn the headset on: after 10 seconds the Bluetooth light flashes red and blue for about a minute.",
      pickIn("Delta Zulu_ and the last four digits of its serial number"),
      "Lightspeed's own app records the radio; here the headset most likely sends only your boom mic.",
      GROUND_TEST,
    ],
    says: "Delta Zulu: most likely hears only your voice here; the radio goes to Lightspeed's own app. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://www.flightstore.com.au/assets/files/Delta-Zulu-User-Guide-0922.pdf (Delta Zulu User Guide 704-00028-000 REV0922, pp.19, 23; " + SEEN + ")",
      "https://www.lightspeedaviation.com/delta-zulu-support/ (Lightspeed Delta Zulu support FAQ: the app will \"perform flight record regardless of what audio device is selected\"; " + SEEN + ")",
    ],
  },
  {
    // Shows as "Zulu 4_#####" (UG p.2). With DIP switch 6, Record Comms,
    // on, "the recipient of a cell phone call will hear all sounds on the
    // intercom" (pp.11, 16), so its hands-free uplink may carry the
    // intercom, radio included; Lightspeed's app records "all incoming and
    // outgoing communications". Untested with a browser.
    id: "lightspeed-zulu-4",
    maker: "Lightspeed",
    model: "Zulu 4",
    kind: "headset",
    shows: "Zulu 4_#####",
    names: [/\bZulu[\s.]?4(?!\d)/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Set DIP switch 6 (Record Comms) on, in the battery box.",
      "Hold the Bluetooth button for two seconds until it flashes red and blue.",
      pickIn("Zulu 4_ and its number"),
      GROUND_TEST,
      "With DIP switch 6 on, anyone you phone hears the intercom: unplug the headset from the panel for calls.",
    ],
    says: "Zulu 4: may send the intercom and radio with DIP switch 6 on, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: ["https://www.sportys.com/media/pdf/zulu4userguide.pdf (Zulu 4 User Guide 704-00037-000.A1, 7/25, pp.2, 11-12, 16; " + SEEN + ")"],
  },
  {
    // Shows as "Zulu PFX ####". FlightLink's recorder "will work with
    // either the auxiliary input cable or a wireless Bluetooth connection"
    // and records "all radio and intercom communication" (UG pp.13, 16).
    // Superseded; untested with a browser.
    id: "lightspeed-zulu-pfx",
    maker: "Lightspeed",
    model: "Zulu PFX",
    kind: "headset",
    shows: "Zulu PFX ####",
    names: [/\bZulu[\s.]*PFX\b/i, /\bLightspeed\b.*\bPFX\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Put the headset in pairing mode: the Bluetooth light flashes red and blue.",
      pickIn("Zulu PFX and the last four digits of its serial number"),
      "Lightspeed's FlightLink recorded the radio over this link; the headset must be plugged into the intercom.",
      GROUND_TEST,
    ],
    says: "Zulu PFX: sent the radio to Lightspeed's FlightLink, untested here. Check the words follow the ATIS.",
    confidence: "test",
    sources: ["https://www.sportys.com/media/pdf/Zulu_PFX_User_Guide.pdf (Zulu PFX User Guide, pp.13, 16-17; " + SEEN + ")"],
  },
  {
    // All three show as "Lightspeed-V###" (Zulu 3 support page; Sierra UG
    // p.11; Tango UG p.16), so a label can't tell them apart: one entry.
    // Lightspeed: over Bluetooth "the hot mic scenario using your headset
    // microphone"; to record, its own four-conductor cable from the battery
    // box's AUX port, with DIP switch 6 on for a Zulu 3.
    id: "lightspeed-zulu-3-sierra-tango",
    maker: "Lightspeed",
    model: "Zulu 3, Sierra or Tango",
    kind: "headset",
    shows: "Lightspeed-V###",
    names: [
      /\bLightspeed-V\w*/i,
      /\bZulu[\s.]?3(?!\d)/i,
      /\bLightspeed\b.*\b(Sierra|Tango)\b/i,
    ],
    gives: "voice",
    steps: [
      "Over Bluetooth it sends the phone your boom mic, never the radio.",
      "For the radio, plug the headset's own audio cable from the AUX port on its battery box into the iPhone.",
      "Use a four-conductor cable: a three-conductor one leaves the iPhone's microphone on.",
      "On a Zulu 3, set DIP switch 6 (FlightLink) on.",
      "Turn the headset's Bluetooth off, or it overrides the cable.",
      "An iPhone without a headphone jack needs Apple's own adapter, which may not work on USB-C iPhones: test it on the ground.",
    ],
    says: "Lightspeed headset: hears your voice, not the radio. For the radio, use its audio cable or the audio panel's recording mode.",
    confidence: "documented",
    sources: [
      LIGHTSPEED_FLIGHTLINK,
      "https://rev.lightspeedaviation.com/?p=8108 (Zulu 3 Support, ©2024: \"Select Lightspeed-V### (numbers may vary)\"; " + SEEN + ")",
      "https://www.siebert.aero/media/articles/pdf/SierraUserGuide_A1.pdf (Sierra User Guide 704-00001-000 Rev. A1, ©2010, p.11; " + SEEN + ")",
      "https://flightstore.com.au/assets/files/TANGO_UG_Sept2021_V2.pdf (Tango User Guide 704-00009-000 REV0921, pp.16-17; " + SEEN + ")",
    ],
  },
  {
    // Bluetooth for calls and music; recording over the supplied cable
    // (FlightLink FAQ). Its Bluetooth name wasn't found in a manual we could
    // open, so it's recognised by model only.
    id: "lightspeed-zulu-2",
    maker: "Lightspeed",
    model: "Zulu 2",
    kind: "headset",
    shows: null,
    names: [/\bZulu[\s.]?2(?!\d)/i],
    gives: "voice",
    steps: [
      "Over Bluetooth it sends the phone your boom mic, not the radio.",
      "For the radio, plug the headset's own audio cable from the AUX port on its battery box into the iPhone, and turn its Bluetooth off.",
      "An iPhone without a headphone jack needs Apple's own adapter, which may not work on USB-C iPhones: test it on the ground.",
    ],
    says: "Zulu 2: hears your voice, not the radio. For the radio, use its audio cable or the audio panel's recording mode.",
    confidence: "likely",
    sources: [LIGHTSPEED_FLIGHTLINK, SPORTYS_FAQ],
  },
  {
    // The Zulu H-Mod helmet kit. Its guide (704-00027-000.A1) refused us;
    // Lightspeed documents Bluetooth recording for none of its headsets but
    // the PFX, Delta Zulu and Zulu 4. Recognised by model only.
    id: "lightspeed-h-mod",
    maker: "Lightspeed",
    model: "Zulu H-Mod",
    kind: "headset",
    shows: null,
    names: [/\bZulu[\s.]*H-?Mod\b/i, /\bLightspeed\b.*\bH-?Mod\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", CABLE],
    says: "Zulu H-Mod: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [LIGHTSPEED_FLIGHTLINK, SPORTYS_FAQ],
  },

  // ---- Bose headsets ----
  {
    // "When Bose A20 appears in the list of devices, select and confirm"
    // (pp.17-22); "During flight operations, do not use the headset for
    // telephone calls." Nothing sends the intercom to the phone.
    id: "bose-a20",
    maker: "Bose",
    model: "A20",
    kind: "headset",
    shows: "Bose A20",
    names: [/\bBose\s*A20\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "Bose says not to make phone calls with it in flight.", CABLE],
    says: "Bose A20: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://archive.org/download/manualsonline-id-0246f315-867e-43d5-87cd-e868088c00c8/0246f315-867e-43d5-87cd-e868088c00c8.pdf (Bose A20 Owner's Guide AM325453 Rev.07, 2012, safety page and pp.17-22; " + SEEN + ")",
      SPORTYS_FAQ,
    ],
  },
  {
    // The device list shows "Bose A30" (p.39); "Do NOT make phone calls
    // while piloting" (p.3); in a call "intercom and phone call audio are
    // mixed" for the wearer only (p.45).
    id: "bose-a30",
    maker: "Bose",
    model: "A30",
    kind: "headset",
    shows: "Bose A30",
    names: [/\bBose\s*A30\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "Bose says not to make phone calls while piloting.", CABLE],
    says: "Bose A30: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://www.siebert.aero/media/articles/pdf/Bose_A30_Manual_english.pdf (Bose A30 Aviation Headset owner's guide, ©2023, pp.3, 39, 43-45; " + SEEN + ")",
      SPORTYS_FAQ,
    ],
  },
  {
    // Its own guide wasn't opened; Bose's Connect app can rename it, so it
    // is recognised by "ProFlight" only. A Bluetooth aviation headset can't
    // put cockpit audio on a phone (Sporty's).
    id: "bose-proflight-2",
    maker: "Bose",
    model: "ProFlight Series 2",
    kind: "headset",
    shows: null,
    names: [/\bProFlight\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", CABLE],
    says: "Bose ProFlight: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [SPORTYS_FAQ, "https://www.bose.com/p/headphones-aviation-headsets/proflight-series-2-aviation-headset/PFS2-HEADSETAVIA.html (Bose ProFlight Series 2 page: Bluetooth audio mixes with the intercom; the Bose Connect app renames it; nothing on recording; " + SEEN + ")"],
  },

  // ---- David Clark headsets ----
  {
    // "Select DC ONE-X" (QRG p.9), for the ONE-XP too, which "have all the
    // same" features; one ONE-XP, 43102G-13, has no Bluetooth (p.12). Calls
    // while plugged in are "not recommended and may violate applicable
    // regulations", and nothing sends the radio to the phone (p.10).
    id: "dc-one-x",
    maker: "David Clark",
    model: "DC ONE-X or ONE-XP",
    kind: "headset",
    shows: "DC ONE-X",
    names: [/\bDC\s*ONE-?XP?\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "David Clark doesn't recommend calls while it's plugged into the intercom.", CABLE],
    says: "DC ONE-X: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://www.davidclarkcompany.com/files/literature/230-42427%20DC%20ONE%20QRG%20Rev%2011-25.pdf (DC ONE-X Quick Reference Guide 230-42427 Rev 11-25, pp.9-10, 12; " + SEEN + ")",
      SPORTYS_FAQ,
    ],
  },
  {
    // "Select DC PRO-X2" (QRG p.7); 43105G-07 and -10 have no Bluetooth;
    // the same call wording as the ONE-X (p.8).
    id: "dc-pro-x2",
    maker: "David Clark",
    model: "DC PRO-X2",
    kind: "headset",
    shows: "DC PRO-X2",
    names: [/\bDC\s*PRO-?X\s?2\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "David Clark doesn't recommend calls while it's plugged into the intercom.", CABLE],
    says: "DC PRO-X2: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://www.davidclarkcompany.com/files/literature/230-42431%20DC%20PRO-X2%20QRG%20Rev%2011-25.pdf (DC PRO-X2 Quick Reference Guide 230-42431 Rev 11-25, pp.7-8; " + SEEN + ")",
      SPORTYS_FAQ,
    ],
  },

  // ---- Not connected to the airplane ----
  {
    // AirPods have no connection to the airplane's audio: their microphones
    // hear the wearer and the cabin. Their name is the owner's to change
    // ("Rename your AirPods"), and "AirPods" stays in it as shipped.
    id: "apple-airpods",
    maker: "Apple",
    model: "AirPods",
    kind: "headset",
    shows: null,
    names: [/\bAirPods\b/i],
    gives: "voice",
    steps: ["AirPods aren't connected to the airplane's audio.", "Disconnect them before listening to the radio: the last Bluetooth device to connect takes the input."],
    says: "AirPods: hear your voice and the cabin, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "documented",
    sources: ["https://support.apple.com/guide/airpods/deva392f031a/web (Apple, Rename your AirPods; " + SEEN + ")"],
  },

  // ---- Cables: a wired microphone of everything the headset hears ----
  {
    // "Capture all audio heard through your headset, including ATC
    // communications", in line with a twin-plug headset, into USB-C,
    // "Works with iPhone 15", $39.99 at Sporty's (SKU 7718). On the
    // iPhone it is a wired input, not HFP.
    id: "nflightcam-409c",
    maker: "NFlightCam",
    model: "Audio Cable for Smartphones, USB-C (409C)",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio",
    steps: [
      "Plug it in line between your headset's two plugs and the airplane's jacks, and into the iPhone's USB-C port (iPhone 15 and later).",
      "Disconnect Bluetooth headsets and AirPods so the cable stays the input.",
      GROUND_TEST,
    ],
    says: "NFlightCam cable: the radio comes in, with the intercom.",
    confidence: "documented",
    sources: ["https://www.sportys.com/nflightcam-audio-recording-cable-for-smartphones.html (Sporty's, NFlightCam Audio Cable for Smartphones with USB Type-C, $39.99; " + SEEN + ")"],
  },
  {
    // Records "all transmissions through the Intercom systems including
    // in-cabin and ATC transmissions" through a 3.5 mm four-conductor plug.
    // NFlightCam's own 3.5 mm cable needs Apple's adapter and is listed as
    // not for iPhone 15, so a USB-C adapter isn't a sure thing.
    id: "pilot-usa-pa-80s",
    maker: "Pilot USA",
    model: "PA-80S/iPhone",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio",
    steps: [
      "Plug it in line with your headset's two plugs, and its 3.5 mm plug into the iPhone through Apple's own headphone adapter.",
      "Adapters on USB-C iPhones aren't sure to work, and one pilot found the audio scratchy.",
      GROUND_TEST,
    ],
    says: "Pilot USA cable: the radio comes in, with the intercom, once the adapter works.",
    confidence: "test",
    sources: [
      "https://www.aircraftspruce.com/catalog/pnpages/11-10531.php (Aircraft Spruce, Pilot USA PA-80S/iPhone, P/N 11-10531; " + SEEN + ")",
      "https://pilotsofamerica.com/community/threads/how-can-i-record-cockpit-video-audio-with-iphone.101530/post-2282808 (a pilot's report: \"very scratchy and skippy\"; " + SEEN + ")",
    ],
  },
  {
    // A TRRS plug that "provides a single channel microphone input"; Sporty's
    // says it records "intercom activity". Phones without a 3.5 mm jack need
    // an adapter.
    id: "flight-gear-ga-audio-input",
    maker: "Flight Gear",
    model: "GA Audio Input Cable",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio",
    steps: [
      "Plug it in line with your headset's two plugs, and its 3.5 mm plug into the iPhone through Apple's own headphone adapter.",
      "Adapters on USB-C iPhones aren't sure to work.",
      GROUND_TEST,
    ],
    says: "Flight Gear cable: the radio comes in, with the intercom, once the adapter works.",
    confidence: "test",
    sources: ["https://www.sportys.com/flight-gear-ga-audio-input-cable.html (Sporty's, Flight Gear GA Audio Input Cable, $19.99; " + SEEN + ")"],
  },
  {
    // For Appareo's own apps; "ATC Radio Transcription & Playback feature
    // does not work on ... iPhone 12 and newer".
    id: "appareo-stratus-audio",
    maker: "Appareo",
    model: "Stratus Audio Cable",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio-maybe",
    steps: [
      "Appareo says its radio playback doesn't work with this cable on iPhone 12 and later; use another cable there.",
      "On an older iPhone, plug it in line with your headset's two plugs.",
      GROUND_TEST,
    ],
    says: "Stratus Audio Cable: Appareo says it doesn't work on iPhone 12 and later. Check the words follow the ATIS.",
    confidence: "test",
    sources: ["https://www.aircraftspruce.com/catalog/avpages/appareo_11-19009.php (Aircraft Spruce, Appareo Stratus Audio Cable, P/N 11-19009; " + SEEN + ")"],
  },
];

/** A label as the browser gives it, without Chrome's "Default - " and
 *  Windows' "Communications - " in front of the system's choice. */
const bare = (label: string) => label.replace(/^(Default|Communications)\s*-\s*/i, "").trim();

/** The gear an input's label names, or null. */
export function gearFor(label: string | null | undefined): Gear | null {
  const name = bare(label ?? "");
  if (!name) return null;
  return GEAR.find(g => g.names.some(re => re.test(name))) ?? null;
}

/** The catalogue's panels, headsets or cables, in its order. */
export function gearByKind(kind: GearKind): Gear[] {
  return GEAR.filter(g => g.kind === kind);
}

/** The phone's or computer's own microphone by its label: Safari's
 *  "iPhone Microphone" and "MacBook Pro Microphone", Chrome's "(Built-in)"
 *  and its Android names for the phone's mics ("Speakerphone", "Headset
 *  earpiece", Chromium's CommunicationDeviceSelector), and a Windows
 *  laptop's "Microphone Array". As lib/audioInput tells its own from an
 *  outside input. */
const BUILT_IN = [
  /^default$/i,
  /\b(iPhone|iPad|iPod)\b.*\bMicrophone\b/i,
  /\(Built-in\)/i,
  /^(MacBook( Air| Pro)?|iMac|Mac( mini| Studio| Pro)?|Studio Display|Built-in|Internal) Microphone\b/i,
  /^Microphone Array\b/i,
  /^(Speakerphone|Headset earpiece)$/i,
];

/** What the app is hearing through the live input, by its label. It says
 *  the radio only for gear whose maker documents the radio reaching a
 *  phone; anything it can't name, or that may or may not send the radio,
 *  is unknown. With no label it is the phone's microphone: a capture that
 *  names no input mostly lands on "iPhone Microphone" even with a headset
 *  connected (WebKit bug 282939), and lib/audioInput counts a blank name
 *  as the device's own. */
export function hearing(label: string | null | undefined): Hearing {
  const name = bare(label ?? "");
  if (!name || BUILT_IN.some(re => re.test(name))) return "phone-mic";
  const gives = gearFor(name)?.gives;
  if (gives === "radio") return "radio";
  if (gives === "voice") return "voice";
  return "unknown";
}
