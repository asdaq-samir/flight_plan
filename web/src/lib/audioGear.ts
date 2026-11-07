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
 * documents a Bluetooth name only for the GMA 35c (a GTN figure shows
 * "GMA Bluetooth"), so its other panels are recognised by model number
 * only.
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
// The same rule for a phone on a cable, which needs no Bluetooth.
const CABLE_AIRPLANE_MODE = "Turn on airplane mode: the phone's cellular radio must stay off in the air.";
// iOS routes to the separate Bluetooth device that connected last ("last
// in wins", Apple's AVAudioSessionCategoryOptions header).
const OTHERS_OFF = "Disconnect AirPods, the car and any other Bluetooth audio: the last one to connect takes the input.";
// A panel's call carries the intercom's microphones, not the radio.
// Garmin's GMA 350c guide has the headset mics "speak on the call" (p.36);
// PS Engineering's PAR200B and PMA8000BT guides and Avidyne's AMX240
// manual (§3.5, "The telephone party does not hear ATC") say the phone
// doesn't hear ATC. For the GMA 345, 245, 35c and 1360 and the PMA450s,
// whose manuals don't say what a call carries, it follows from these.
const NO_CALL = "Never place a phone call through it: a call sends the intercom's microphones, not the radio.";
const GROUND_TEST = "Before relying on it, tune the ATIS with the cabin speaker off and check the words follow it.";
// The NFlightCam USB-C cable is "Compatible with standard twin-plug
// headsets" and "Designed specifically for fixed-wing aircraft" (Sporty's
// 7718), so a headset with a 6-pin (Lemo or Redel) or XLR panel-power plug
// needs a recording cable made for that plug.
const CABLE = "For the radio, use a recording cable made for your headset's plug: the NFlightCam USB-C cable fits twin plugs, not a 6-pin or XLR panel-power plug.";

const pickIn = (what: string) => `In the iPhone's Settings, Bluetooth, pick ${what}.`;

// Garmin's GMA 350c and 350Hc: the same keys turn Recording Mode off
// again, so the step checks PILOT first (350c p.38, 350Hc p.40).
const RECORDING_ON = "Once it's connected, if PILOT isn't already blue, press PILOT and the small knob together: PILOT turns blue and you hear \"Bluetooth Recording Mode Enabled\". The panel remembers it for this phone; pressing them together again turns it off.";
// Garmin documents a call carrying the headset mics (350c p.36, 350Hc
// p.38) and only Recording Mode sending the radio (350c p.38, 350Hc p.40).
const GARMIN_NO_CALL = "Don't use a phone call for this: Garmin documents a call carrying only the headset microphones, and only Recording Mode sending the radio.";
// Garmin's GMA 345 and 245: one Bluetooth connection at a time, and the
// wired music inputs still play (345 PG pp.25, 29; 245 PG pp.15, 25).
const ONE_CONNECTION = "The panel holds one Bluetooth connection at a time: while the phone is connected, no other phone, tablet or camera can connect. Music wired to the panel still plays.";
// "Momentarily" (345 PG p.29, 245 PG p.25): held, TEL (PAIR) pairs and
// disconnects the device connected, and PILOT toggles 3D audio.
const RECORDING_TEL_PILOT = "Once it's connected, briefly press TEL (PAIR) and PILOT together, without holding: you hear \"Bluetooth Recording Mode Enabled\". It's needed once for each phone.";

const GARMIN_350C = "https://static.garmin.com/pumac/190-01134-12_L.pdf (GMA 350/350c Pilot's Guide 190-01134-12 Rev. L, June 2017, pp.10-11, 15-24, 36-38; " + SEEN + ")";
const GARMIN_2015 = "https://garmin.com/en-US/newsroom/?p=1681 (Garmin release, 16 July 2015: the GMA 350c series is the 350c, 35c and 350Hc; VIRB XE gets intercom and ATC over Bluetooth; " + SEEN + ")";
const GARMIN_2017 = "https://garmin.com/en-US/newsroom/?p=1409 (Garmin release, 29 March 2017: Bluetooth on the GMA 345, a 3.5 mm jack on the GMA 342, both slide-in for the GMA 340; " + SEEN + ")";
const GARMIN_342_345_IM = "https://static.garmin.com/pumac/190-01878-02_06.pdf (GMA 342/345 Installation Manual 190-01878-02 Rev. 6, July 2023, pp.1-1, 1-2, 1-5; " + SEEN + ")";
const GARMIN_245_IM = "https://static.garmin.com/pumac/190-01879-11_14.pdf (GMA 245/245R Installation Manual 190-01879-11 Rev. 14, March 2026, pp.1-1, 1-4; " + SEEN + ")";
const GARMIN_G3X_EXP = "https://static.garmin.com/pumac/190-01754-00_z.pdf (G3X Touch Pilot's Guide 190-01754-00 Rev. Z, May 2024, pp.130-132; " + SEEN + ")";
const PSE_450B_PG = "https://www.ps-engineering.com/assets/docs/PMA450B_PG.pdf (PMA450B Pilot Guide 202-450-0600 Rev. 11, April 2025, pp.10-14 (BT1 and BT2 names p.12), 18-24; " + SEEN + ")";
const PSE_450B_IM = "https://www.ps-engineering.com/assets/docs/PMA450B_IM.pdf (PMA450B Installation Manual 200-450-0600 Rev. 6, June 2023, §2.7.5.3, §2.12.4.1 p.2-16, §3.11.1.2 p.3-13, §3.12 pp.3-13 to 3-14, §3.15; " + SEEN + ")";
const PSE_450A_IM = "https://www.ps-engineering.com/assets/docs/PMA450A_IM.pdf (PMA450A Installation Manual 200-450-0100 Rev. 7, February 2018, §2.7.4.3 p.2-12, §2.12.4.1 p.2-15, §3.12 p.3-14, §3.15, §3.18.2; " + SEEN + ")";
const PSE_450A_PG = "https://www.ps-engineering.com/assets/docs/PMA450A_PG.pdf (PMA450A Pilot Guide 202-450-0103 Rev. 3, March 2018, pp.12, 14, 18, 21-23; " + SEEN + ")";
const PSE_8000G_IM = "https://www.ps-engineering.com/assets/docs/PMA8000G_IM.pdf (PMA8000G Installation Manual 200-890-0912 Rev. 20, November 2025, §2.4.15; revision 15, August 2021: \"Discontinued -0913 version\"; " + SEEN + ")";
const PSE_8000G_STREAMER_PG = "https://jaxnfc.com/wp-content/uploads/2020/07/PMA8000G_PG.pdf (PMA8000G Pilot Guide 202-890-0913 Rev. 5, July 2020, pp.17-18, PS Streamer for 050-890-0913; the June 2017 edition says the same; " + SEEN + ")";
const PSE_8000G_DS = "https://www.ps-engineering.com/assets/docs/PMA8000G_DS.pdf (PMA8000G data sheet: \"With BT Streaming ... 050-890-0913\"; " + SEEN + ")";
const LIGHTSPEED_FLIGHTLINK = "https://rev.lightspeedaviation.com/?p=8117 (Lightspeed FlightLink Support and FAQ, ©2024: newer Sierra and Zulu 2 compatible, older ones a $69 retrofit; the cable for Zulu 2, Zulu 3, Tango and Sierra, four conductors; Bluetooth \"will override the audio cable and create the 'hot mic' scenario using your headset microphone\"; on the Zulu 3, Tango and Sierra Bluetooth is for calls and music, recording on the PFX; " + SEEN + ")";
const SPORTYS_FAQ = "https://www.sportys.com/blog/bluetooth-in-aviation-headsets-frequently-asked-questions/ (Sporty's, 18 Sep 2025: a Bluetooth aviation headset can't record cockpit audio on a phone; that needs an adapter into the intercom; " + SEEN + ")";
const NFLIGHTCAM_SPORTYS = "https://www.sportys.com/nflightcam-audio-recording-cable-for-smartphones.html (Sporty's, NFlightCam Audio Cable for Smartphones with USB Type-C, SKU 7718, $39.99: \"Compatible with standard twin-plug headsets\", \"Designed specifically for fixed-wing aircraft\", \"Not compatible with earlier iPhones\"; " + SEEN + ")";

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
    // (p.38). The app can't see whether the mode is on, and without it
    // Garmin documents the link only as a phone or music source whose call
    // carries the headset mics (p.36), so the line asks for PILOT blue. It
    // is whatever the pilot hears, so isolating the intercom (pp.19, 21)
    // and taking music and the phone off PILOT in Blue-Select (pp.23-24)
    // leave nearly only the radio; alerts and selected NAV and marker
    // idents still come (alerts p.18; NAV p.15; MKR pp.16-17). No report of
    // a phone receiving it was found, and the mode depends on the panel's
    // software (Rev. K and L of the guide describe it), so it is checked
    // on the ground. Garmin gives no Bluetooth name; the pattern takes the
    // model however it is spaced or followed ("GMA350c_1234").
    id: "garmin-gma-350c",
    maker: "Garmin",
    model: "GMA 350c",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s_-]*350\s*c(?![a-z])/i],
    gives: "radio",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold the panel's small knob for two seconds: the Bluetooth light flashes and the panel can be found for 90 seconds.",
      pickIn("the audio panel"),
      RECORDING_ON,
      "For the radio with fewer voices, use Pilot Isolate, and take the blue music and phone off PILOT in Blue-Select.",
      "Selected NAV and marker idents and the airplane's alerts still come through, so deselect NAV and MKR when you're not identifying.",
      GROUND_TEST,
      GARMIN_NO_CALL,
    ],
    says: "GMA 350c: the radio comes in once PILOT is blue (Bluetooth Recording Mode). Check the words follow the ATIS.",
    confidence: "documented",
    sources: [GARMIN_350C],
  },
  {
    // Its own guide has the same recording mode, word for word, naming "a
    // smart phone or tablet app", and the same keys turn it off again
    // (p.40); a call carries the headset mics (p.38). The pairing light is
    // green (p.38). Checked on the ground for the 350c's reasons.
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
      RECORDING_ON,
      "For the radio with fewer voices, isolate the pilot's intercom and take the blue music and phone off PILOT in Blue-Select.",
      GROUND_TEST,
      GARMIN_NO_CALL,
    ],
    says: "GMA 350Hc: the radio comes in once PILOT is blue (Bluetooth Recording Mode). Check the words follow the ATIS.",
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
    // Garmin documents no phone getting the radio. The guide lists HFP "for
    // connection to a telephone"; the VIRB gets "pilot headphone audio"
    // (p.29); Bluetooth Recording Mode is described only for third-party
    // cameras that take audio over HFP (pp.27, 29); a phone appears only
    // to pair (p.28). Its keys are pressed "momentarily" (p.29): holding
    // TEL (PAIR) for a second pairs and disconnects the device connected
    // (p.28), holding PILOT toggles 3D audio (p.22), and TEL for five
    // seconds turns Bluetooth off (p.30). One Bluetooth connection at a
    // time (p.29; installation manual p.1-5), but the wired music still
    // plays (p.25; IM p.1-1). Pilot ICS isolation takes the pilot off the
    // intercom (p.19) and off music (p.25). Garmin makes no "GMA 345c": the
    // 345 is its Bluetooth panel and the 342 has none. The 345 3-COM is
    // the same unit unless noted (IM p.1-2), and the pattern takes it too.
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
      "Hold TEL (PAIR) for one second: the Bluetooth light flashes, you hear \"Pairing Enabled\", and the panel can be found for two minutes.",
      "If another phone or tablet is connected to the panel, holding TEL (PAIR) for one second disconnects it.",
      pickIn("the audio panel"),
      RECORDING_TEL_PILOT,
      ONE_CONNECTION,
      "For the radio with fewer voices, use PILOT ICS isolation, which also takes music off the pilot.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 345: may send the radio in its recording mode, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-01878-01_d.pdf (GMA 345 Pilot's Guide 190-01878-01 Rev. D, June 2023, pp.19, 22, 24-30; " + SEEN + ")",
      GARMIN_342_345_IM,
      GARMIN_2017,
    ],
  },
  {
    // The audio panel of a G1000 NXi that has Bluetooth; the same Cessnas
    // can have a GMA 1347 instead (190-02823-00 Rev. A printed p.1).
    // "If the Audio Panel detects a recording device as the Bluetooth
    // connected source, the PILOT ICS annunciation will turn blue. All
    // audio heard by the Pilot will be recorded", and holding PILOT ICS
    // switches the mode on and off (printed pp.119, 144). Whether it takes
    // a phone for a recording device isn't said; the colour shows which it
    // did, read while no TEL or MUS key flashes, as Blue-Select also lights
    // the ICS keys blue (pp.142, 145). An NXi may also list a Flight Stream
    // in the phone (p.486). Garmin gives no Bluetooth name; an owners'
    // forum reports the default as "GMA-1 PIA-1" and a serial, unverified,
    // so the default name probably isn't recognised here. What a call
    // carries isn't in this guide; NO_CALL follows from the siblings.
    id: "garmin-gma-1360",
    maker: "Garmin",
    model: "GMA 1360 (G1000 NXi, with a Bluetooth light on the panel)",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*1360\s*D?\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold the audio panel's small knob for two seconds: the Bluetooth light flashes and the panel can be found for 60 seconds.",
      "In the iPhone's Settings, Bluetooth, pick the new device that appears while the panel's Bluetooth light flashes, not the Flight Stream.",
      "Once it's connected, look at PILOT ICS. If it's blue, recording mode is on: leave it. If it's white, press and hold PILOT ICS; the hold switches recording mode on and off.",
      "Read the colour only while no TEL or MUS key is flashing. Blue then means the panel sends the phone everything the pilot hears. White means it hasn't taken the phone for a recording device, so the radio isn't reaching the phone.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 1360: may send the radio if PILOT ICS is blue with no key flashing, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-02177-03_a.pdf (G1000 NXi Pilot's Guide for the Cessna NAV III 190-02177-03 Rev. A, ©2017-2019, 2021, printed pp.119-120, 142, 144-145, 485-486; " + SEEN + ")",
      "https://static.garmin.com/pumac/190-02823-00_a.pdf (G1000 NXi Pilot's Guide for the Cessna NAV III 190-02823-00 Rev. A, software 4013.00, printed p.1: \"GMA 1347 (1)\"; " + SEEN + ")",
    ],
  },
  {
    // The audio panel of the G1000, and of G1000 NXi airplanes without the
    // optional GMA 1360: "GMA 1347 / GMA 1360 (1) ... The optional GMA
    // 1360 offers Bluetooth" (190-02177-01 Rev. A printed p.2), under the
    // heading "BLUETOOTH (GMA 1360 ONLY)" (p.137); 190-02177-00 Rev. B and
    // 190-02823-00 list only the GMA 1347. The G1000 guide's 662 pages
    // never mention Bluetooth; the GMA 1347 is "NAV/COM digital audio,
    // intercom system and marker beacon controls" (printed p.3).
    id: "garmin-gma-1347",
    maker: "Garmin",
    model: "GMA 1347 (G1000 or G1000 NXi)",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 1347 has no Bluetooth, in a G1000 or a G1000 NXi.", CABLE],
    says: "GMA 1347: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [
      "https://static.garmin.com/pumac/190-00498-08_0A_Web.pdf (G1000 Pilot's Guide for the Cessna NAV III 190-00498-08 Rev. A, May 2013, printed p.3; no Bluetooth in its 662 pages; " + SEEN + ")",
      "https://static.garmin.com/pumac/190-02177-01_a.pdf (G1000 NXi Pilot's Guide for the Cessna NAV III 190-02177-01 Rev. A, May 2018, printed pp.2, 137; " + SEEN + ")",
      "https://static.garmin.com/pumac/190-02177-00_b.pdf (G1000 NXi Pilot's Guide for the Cessna NAV III 190-02177-00 Rev. B, May 2017, printed p.2; " + SEEN + ")",
      "https://static.garmin.com/pumac/190-02823-00_a.pdf (G1000 NXi Pilot's Guide for the Cessna NAV III 190-02823-00 Rev. A, software 4013.00, printed p.1; " + SEEN + ")",
    ],
  },
  {
    // The remote GMA 245R under a G3X Touch. Its G3X guides name only a
    // VIRB for "pilot headphone audio" over Bluetooth and have no control
    // for a recording mode (certified Rev. G pp.110-112; experimental Rev.
    // Z pp.130-132). One Bluetooth connection at a time (IM p.1-4).
    id: "garmin-gma-245r",
    maker: "Garmin",
    model: "GMA 245R (under a G3X Touch)",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*245\s*R\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "On the G3X Touch, touch Audio on the data bar (or Audio Panel in the Main Menu), then the Phone & Media tab, and touch Pair Device.",
      pickIn("the audio panel"),
      "Garmin documents its headphone audio over Bluetooth only to a VIRB camera, and the G3X Touch has no control for a recording mode, so a phone may get only the intercom.",
      "The panel connects one Bluetooth device at a time.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 245R: Garmin sends its audio only to a VIRB camera, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-02472-00_g.pdf (G3X Touch Pilot's Guide for Certified Aircraft 190-02472-00 Rev. G, 2024, pp.110-112; " + SEEN + ")",
      GARMIN_G3X_EXP,
      GARMIN_245_IM,
    ],
  },
  {
    // The panel-mount GMA 245, standalone or on a G3X's CAN bus (PG p.9).
    // Its guide lists HFP "for connection to a telephone" and audio to
    // "third-party cameras that are capable receiving audio via the
    // Hands-Free Profile" (p.23), with the GMA 345's Recording Mode: press
    // TEL (PAIR) and PILOT "momentarily" (p.25). Without it, TEL connects
    // the pilot to the phone, a call (p.21). One Bluetooth device at a
    // time (p.25; IM p.1-4); two wired music inputs (p.15). As the 345, a
    // camera, not a phone, is named, so it is checked on the ground.
    id: "garmin-gma-245",
    maker: "Garmin",
    model: "GMA 245",
    kind: "panel",
    shows: null,
    names: [/\bGMA[\s-]*245\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Hold TEL (PAIR) for one second: the Bluetooth light flashes, you hear \"Pairing Enabled\", and the panel can be found for two minutes. With a G3X Touch, Pair Device on the Audio Panel's Phone & Media tab does the same.",
      pickIn("the audio panel"),
      RECORDING_TEL_PILOT,
      ONE_CONNECTION,
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 245: may send the radio in its recording mode, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-01879-10_h.pdf (GMA 245 Pilot's Guide 190-01879-10 Rev. H, 2024, pp.9, 15, 21, 23-26; " + SEEN + ")",
      GARMIN_245_IM,
      GARMIN_G3X_EXP,
    ],
  },
  {
    // The remote panel under a GTN 750 or 750Xi. Garmin documents its
    // cockpit audio over Bluetooth only to a VIRB XE: the 35c can "connect
    // wirelessly to the VIRB XE" (GMA 35/35c Installation Manual
    // 190-00858-11 Rev. H, p.1-1), and the 2015 release has the VIRB XE
    // overlay intercom and ATC. Neither GTN guide has a control for a
    // recording link or names a VIRB: the Xi's gives its Bluetooth only who
    // hears it, muting and volume (Rev. H p.2-71). The GTN 725/750 guide
    // pairs it from the GTN's Connext Setup page, the phone starting the
    // pairing, one phone at a time, and its figure names the panel "GMA
    // Bluetooth", which the pilot can change (Rev. R p.16-45, Fig. 16-54);
    // a renamed panel falls back to unknown.
    id: "garmin-gma-35c",
    maker: "Garmin",
    model: "GMA 35c (under a GTN 750 or 750Xi)",
    kind: "panel",
    shows: "GMA Bluetooth",
    names: [/\bGMA[\s-]*35\s*c\b/i, /^GMA[\s-]*Bluetooth$/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "On the GTN, open Home, System, Connext Setup, and the GMA 35c's page, and turn Bluetooth on. The panel can be paired only while that page or Manage Paired Devices is open.",
      "The GMA 35c connects one phone at a time, so disconnect any other phone from it first.",
      pickIn("GMA Bluetooth, or the name it was given on the GTN"),
      "The GTN has no control for a recording link, and Garmin documents the cockpit audio over Bluetooth only to a VIRB XE camera, so a phone may get only the intercom.",
      GROUND_TEST,
      NO_CALL,
    ],
    says: "GMA 35c: Garmin documents the cockpit audio only to a VIRB camera, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://static.garmin.com/pumac/190-01007-03_r.pdf (GTN 725/750 Pilot's Guide 190-01007-03 Rev. R, 2019, p.2-25 Bluetooth Setup; p.16-45 §16.12 and Fig. 16-54: pairing mode, \"GMA Bluetooth\", one device at a time; " + SEEN + ")",
      "https://static.garmin.com/pumac/190-02327-03_h.pdf (GTN Xi Pilot's Guide 190-02327-03 Rev. H, 07.01.26, software v21.11, p.2-71; " + SEEN + ")",
      "https://www.manualslib.com/manual/1376052/Garmin-Gma-35.html?page=9 (GMA 35/35c Installation Manual 190-00858-11 Rev. H, p.1-1: VIRB XE link, smartphones and tablets for audio and calls; p.1-3 on page 11 of this copy; " + SEEN + ")",
      GARMIN_2015,
    ],
  },
  {
    // No Bluetooth: "GMA 342 does not have Bluetooth capability"
    // (Installation Manual 190-01878-02 Rev. 6 p.1-1; Table 1-1 p.1-2,
    // "Bluetooth Transceiver: None"). Its front 3.5 mm jack has four
    // conductors and "also allows cell phone calls to be made through the
    // GMA 342" (p.1-5). With TEL on, "intercom audio [is] sent to the
    // telephone device" (Pilot's Guide 190-01878-00 Rev. C p.22). Neither
    // says the radio goes to the phone.
    id: "garmin-gma-342",
    maker: "Garmin",
    model: "GMA 342",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 342 has no Bluetooth. Its 3.5 mm jack is for music or a phone call: with TEL on it sends the phone the intercom, and Garmin doesn't say it sends the radio.", CABLE],
    says: "GMA 342: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [
      "https://static.garmin.com/pumac/190-01878-00_C.pdf (GMA 342 Pilot's Guide 190-01878-00 Rev. C, February 2018, pp.7, 21-22; " + SEEN + ")",
      GARMIN_342_345_IM,
      GARMIN_2017,
    ],
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
    // No Bluetooth (Pilot's Guide 190-00917-00 Rev. A; Installation Manual
    // 190-00917-01 Rev. E feature list p.1-2). Its face jack, "Music 1/TEL"
    // (PG pp.4-5), is a 2.5 mm mini-jack whose tip is "MUSIC 1 LEFT IN/TEL
    // MIC OUT HI" (IM Table 4-3, p.4-4). With TEL on it is the panel's
    // "full-duplex telephone interface" (PG p.9; IM p.1-3) and sends the
    // intercom out to the phone. Neither says the radio goes to the phone.
    id: "garmin-gma-240",
    maker: "Garmin",
    model: "GMA 240",
    kind: "panel",
    shows: null,
    names: [],
    gives: "none",
    steps: ["The GMA 240 has no Bluetooth. Its 2.5 mm jack on the face is for music or a phone call: with TEL on it sends the phone the intercom, and Garmin doesn't say it sends the radio.", CABLE],
    says: "GMA 240: no Bluetooth. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [
      "https://www.aircraftspruce.com/catalog/pdf/gma240pilots.pdf (GMA 240 Pilot's Guide 190-00917-00 Rev. A, June 2008, pp.4-5, 9-10; no Bluetooth in its 12 pages; " + SEEN + ")",
      "https://static.garmin.com/pumac/190-00917-01_E.pdf (GMA 240 Installation Manual 190-00917-01 Rev. E, September 2015, pp.1-2, 1-3, 1-4, 4-4 Table 4-3; " + SEEN + ")",
    ],
  },

  // ---- PS Engineering panels ----
  {
    // The second Bluetooth module (BT2) set as a Streamer is the only
    // output found with a COM-only choice: "The output can contain either
    // the audio heard by the pilot (radio, intercom, music, etc.) or only
    // communications radio audio" (PG p.23; IM §3.15.3). PS Engineering
    // names cameras, not phones, and states no Bluetooth profile. A phone
    // can't use BT2 as an input otherwise: set to Music, "phones ... can
    // only act as streaming devices for music, not calls" (PG pp.10-11),
    // so a BT2 input is a Streamer. Its name, as shipped: "BT2" or "BT 2"
    // and the serial's last four digits (PG pp.12, 18); "PMA450B BT 2" and
    // the four (IM §3.11.1.2); "450A BT2", or "PMA450BT2" to search for, on
    // a PMA450A (PMA450A PG p.12). The setup ID has seven characters (IM
    // §2.7.5.3), so the digits may follow with no space. The Streamer is
    // off at each power-up on a PMA450A (its IM §3.15.2) and in PMA450B IM
    // Rev. 6 §3.15.2; PG Rev. 11 (S/N W45B2849 and up, v4.122, p.22)
    // remembers it. BT1 reconnects by itself at power-up (PG p.12).
    id: "pse-ps-streamer",
    maker: "PS Engineering",
    model: "PMA450B or PMA450A with PS Streamer",
    kind: "panel",
    shows: "BT2 ####, or PMA450B BT 2 ####, or 450A BT2 on a PMA450A",
    names: [/^(?:PMA\s*)?(?:450\s*[AB]?\s*)?BT\s?2(?:[\s_-]*\d{4})?\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Only PMA450B 050-450-0601 or -0701, or PMA450A 050-450-0102, -0104 or -0204, have the PS Streamer.",
      "Disconnect this iPhone from the panel's BT1: it reconnects there by itself at power-up.",
      "While the panel starts up, hold the lower line-select button to open the setup. Go to More, Bluetooth, BT 2 Config and set the BT2 function to Streamer, then turn the panel off and on to leave the setup.",
      "Pair from Radio-ICS, More, Streamer, Config, Pair (Init Pair on older units), then pick the panel's BT2 in the iPhone's Settings, Bluetooth: BT2 and four digits, or 450A BT2 on a PMA450A. BT1 is off while it pairs.",
      "If it hasn't paired in about a minute, press Cancel, wait 2 seconds and press Pair again.",
      "Each flight, check Radio-ICS, More, Streamer, Source reads Radio, not Headphone or Off (the middle button steps through them).",
      "On a PMA450A, and on a PMA450B whose manual says so, the Streamer is off at every power-up: turn it on each flight.",
      GROUND_TEST,
    ],
    says: "BT2 on a PS Engineering panel: may send the radio from a PS Streamer set to Radio, untested with a phone.",
    confidence: "test",
    sources: [PSE_450B_PG, PSE_450B_IM, PSE_450A_IM, PSE_450A_PG],
  },
  {
    // Without the Streamer its Bluetooth (BT1) is phone and music. As
    // shipped BT1 shows as "BT1" and the serial's last four digits, on the
    // PMA450C too, so the line is worded for either; the setup can rename
    // it (PG p.18; IM §2.7.5.3, seven characters, so the digits may follow
    // with no space). Phone mode connects the intercom to the phone, "any
    // person heard by the pilot on the intercom" (IM §2.12.4.1); COM audio
    // goes to the headsets (§3.12). Nothing in the 450 manuals says the
    // phone doesn't hear ATC, so "likely". The model pattern leaves out a
    // label that goes on to BT2, the Streamer (IM §3.11.1.2).
    id: "pse-pma450b",
    maker: "PS Engineering",
    model: "PMA450B",
    kind: "panel",
    shows: "BT1 ####",
    names: [/^BT\s?1(?:[\s_-]*\d{4})?\b/i, /\bPMA[\s-]*450\s*B\b(?!.*BT\s?2)/i],
    gives: "voice",
    steps: [
      "Its Bluetooth (BT1) is for phone and music: a phone hears the intercom, not the radio.",
      "PMA450B units 050-450-0601 and -0701 have a PS Streamer, which may send the radio to the phone on BT2, untested.",
      CABLE,
      NO_CALL,
    ],
    says: "BT1 on a PS Engineering panel: hears the intercom, not the radio. For the radio, use a cable, or a PS Streamer on a PMA450B or 450A that has one.",
    confidence: "likely",
    sources: [PSE_450B_PG, PSE_450B_IM],
  },
  {
    // Ships named "PMA450A" (IM §2.7.4.3 p.2-12); with a PS Streamer its
    // two modules show as "450A BT1" and "450A BT2", searched for as
    // "PMA450BT1" or "PMA450BT2" (PG p.12). Phone mode as the PMA450B's
    // (IM §3.12 p.3-14, §2.12.4.1 p.2-15).
    id: "pse-pma450a",
    maker: "PS Engineering",
    model: "PMA450A",
    kind: "panel",
    shows: "PMA450A; with a PS Streamer, 450A BT1 or PMA450BT1",
    names: [/\bPMA[\s-]*450\s*A\b/i, /(?:^|\bPMA)450\s*A?\s*BT\s?1\b/i],
    gives: "voice",
    steps: [
      "Its Bluetooth is for phone and music: a phone hears the intercom, not the radio.",
      "PMA450A units 050-450-0102, -0104 and -0204 have a PS Streamer, which may send the radio to the phone on BT2, untested.",
      CABLE,
      NO_CALL,
    ],
    says: "PMA450A: hears the intercom, not the radio. For the radio, use a PS Streamer or a cable.",
    confidence: "likely",
    sources: [PSE_450A_IM, PSE_450A_PG],
  },
  {
    // Two Bluetooth modules, no Streamer: "BT1 should be connected to a
    // phone while BT2 must be connected to an iPad or other music
    // streamers ... BT2 can not be connected to a phone for telephone use,
    // only entertainment" (PG p.11). BT2 is labelled "PMA450C BT 2" and
    // four digits (IM §3.10.1.2). The phone hears "any person heard by the
    // pilot on the intercom" (IM §2.11.4.1 checkout).
    id: "pse-pma450c",
    maker: "PS Engineering",
    model: "PMA450C",
    kind: "panel",
    shows: "BT1 #### or BT2 ####",
    names: [/\bPMA[\s-]*450\s*C\b/i],
    gives: "voice",
    steps: ["BT1 is for phone and music, BT2 for music only: on a call the phone hears the intercom, not the radio.", CABLE, NO_CALL],
    says: "PMA450C: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "likely",
    sources: [
      "https://www.ps-engineering.com/assets/docs/PMA450C_PG.pdf (PMA450C Pilot Guide 202-450-0800 Rev. 3, August 2024, pp.11-15 (BT1 and BT2 names p.12); " + SEEN + ")",
      "https://www.ps-engineering.com/assets/docs/PMA450C_IM.pdf (PMA450C Installation Manual 200-450-0800 Rev. 4, August 2024, §2.6.4.3 p.2-10, §2.11.4.1 p.2-14, §3.10.1.2 p.3-12; " + SEEN + ")",
    ],
  },
  {
    // The first PMA450: the pilot searches "for the PMA450" (PG p.10); in
    // phone mode "all crew and passengers will be heard on the phone ...
    // Com audio is automatically heard in the headsets" (p.11). No
    // Streamer. The pattern leaves the 450A, B and C and their BT names.
    id: "pse-pma450",
    maker: "PS Engineering",
    model: "PMA450",
    kind: "panel",
    shows: "PMA450",
    names: [/\bPMA[\s-]*450(?![\s-]*(?:[A-C]\b|BT))\b/i],
    gives: "voice",
    steps: ["Its Bluetooth is for phone and music: a phone hears the intercom, not the radio.", CABLE, NO_CALL],
    says: "PMA450: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "likely",
    sources: ["https://www.ps-engineering.com/assets/docs/PMA450_PG.pdf (PMA450 Pilot Guide 202-450-0000 Rev. 9, December 2015, pp.10-11; " + SEEN + ")"],
  },
  {
    // PMA8000G 050-890-0913, sold until August 2021 (IM revision 15), has a
    // PS Streamer: "a Bluetooth output of selected signals ... to
    // compatible devices such as a GoPro Hero 3 or 4 camera" that can send
    // "communications radio audio" alone ("COM Audio") or all the crew
    // hears ("Headset Audio"), off at each power-up (PG 202-890-0913
    // pp.17-18). The guides give its volume buttons both ways, so they're
    // left out. Its Bluetooth name is undocumented: recognised only if the
    // label names the PMA8000G and a Streamer. If it shows as "PMA8000G"
    // alone, the main Bluetooth's entry below takes it; the owner's ground
    // test should note which name appears.
    id: "pse-pma8000g-streamer",
    maker: "PS Engineering",
    model: "PMA8000G with PS Streamer (050-890-0913)",
    kind: "panel",
    shows: null,
    names: [/\bPMA[\s-]*8000\s*G\b.*\bStream/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Only PMA8000G 050-890-0913 units have the PS Streamer.",
      "Hold AUX and SPR together: the Bluetooth light flashes fast, then slowly, and stays on once paired, in about 30 seconds. If the iPhone doesn't find it, start pairing from the iPhone.",
      "Phone and music drop while the Streamer pairs; reconnect them afterwards.",
      "Hold MUSIC and SPR until you hear \"COM Audio\": that sends the radio alone. \"Headset Audio\" sends everything the crew hears.",
      "The Streamer is off each time the panel is turned on: hold AUX and SPR to turn it on every flight.",
      GROUND_TEST,
    ],
    says: "PMA8000G PS Streamer: may send the radio when set to COM Audio, untested with a phone. Check the words follow the ATIS.",
    confidence: "test",
    sources: [PSE_8000G_STREAMER_PG, PSE_8000G_DS, PSE_8000G_IM],
  },
  {
    // Main Bluetooth for phone and music, phone mode by intercom mode (PG
    // p.11); -0913 adds a PS Streamer (the entry above). From S/N F1256
    // (mid-2017, IM revision 6) a wired "CVR Output (J2, Pin 29)" carries
    // "the audio as heard by the pilot, including selected radios" (IM
    // §2.4.15).
    id: "pse-pma8000g",
    maker: "PS Engineering",
    model: "PMA8000G",
    kind: "panel",
    shows: "PMA8000G",
    names: [/\bPMA[\s-]*8000\s*G\b/i],
    gives: "voice",
    steps: [
      "Its main Bluetooth is for phone and music: a phone hears the intercom, not the radio.",
      "PMA8000G units 050-890-0913, sold until August 2021, have a PS Streamer, a second Bluetooth output that can send the radio alone.",
      "From serial number F1256 (units from mid-2017 on) it has a wired output of what the pilot hears (J2 pin 29), which an installer can bring out to a jack.",
      CABLE,
      NO_CALL,
    ],
    says: "PMA8000G: hears the intercom, not the radio. For the radio, use a PS Streamer (050-890-0913) or a cable on your headset.",
    confidence: "likely",
    sources: [
      "https://www.ps-engineering.com/assets/docs/PMA8000G_PG.pdf (PMA8000G Pilot Guide 202-890-0912 Rev. 9, January 2023, pp.9, 11; " + SEEN + ")",
      PSE_8000G_IM,
      PSE_8000G_STREAMER_PG,
      PSE_8000G_DS,
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
    // versa" (p.10); the phone finds "the 'PAR200B'" (p.9). Its Bluetooth
    // also takes streaming music, as Music #1 (p.12). No wired output of
    // what the pilot hears (IM §2.5, §3.9).
    id: "pse-par200b",
    maker: "PS Engineering",
    model: "PAR200B",
    kind: "panel",
    shows: "PAR200B",
    names: [/\bPAR[\s-]*200\s*B\b/i],
    gives: "voice",
    steps: ["Its Bluetooth is for phone and music: PS Engineering says the phone does not hear ATC.", CABLE, NO_CALL],
    says: "PAR200B: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: [
      "https://www.ps-engineering.com/assets/docs/PAR200B_PG.pdf (PAR200B Pilot Guide 202-228-0300 Rev. 2, August 2024, pp.9-10, 12; " + SEEN + ")",
      "https://www.ps-engineering.com/assets/docs/PAR200B_IM.pdf (PAR200B Installation Manual 200-228-0300 Rev. 5, August 2024, §2.5 p.2-7, §3.9 p.3-10; " + SEEN + ")",
    ],
  },
  {
    // The phone finds "the 'PAR200A'" (p.8); "The telephone party will not
    // hear ATC communications, and vice versa" (p.9); Bluetooth music is
    // Music 1 (p.9).
    id: "pse-par200a",
    maker: "PS Engineering",
    model: "PAR200A",
    kind: "panel",
    shows: "PAR200A",
    names: [/\bPAR[\s-]*200\s*A\b/i],
    gives: "voice",
    steps: ["Its Bluetooth is for phone and music: PS Engineering says the phone does not hear ATC.", CABLE, NO_CALL],
    says: "PAR200A: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.ps-engineering.com/assets/docs/PAR200A_PG.pdf (PAR200A Pilot Guide 202-228-0200 Rev. 1, February 2020, pp.8-9; " + SEEN + ")"],
  },

  // ---- Avidyne ----
  {
    // "The telephone party does not hear ATC communications, and vice
    // versa" (§3.5); "search for the AMX240" (§3.11). Its front 2.5 mm
    // utility jack is also a telephone jack: it carries the intercom to a
    // phone, not ATC (§2.4.8, §3.10.1). No Bluetooth recording mode; the
    // REPLAY recorder plays only to the crew (§3.12).
    id: "avidyne-amx240",
    maker: "Avidyne",
    model: "AMX240",
    kind: "panel",
    shows: "AMX240",
    names: [/\bAMX[\s-]*240\b/i],
    gives: "voice",
    steps: [
      "Its Bluetooth is for phone and music: Avidyne says the phone does not hear ATC.",
      "Its jack on the face gives a phone the intercom, not the radio.",
      CABLE,
      NO_CALL,
    ],
    says: "AMX240: hears the intercom, not the radio. For the radio, use a cable on your headset.",
    confidence: "documented",
    sources: ["https://www.avidyne.com/wp-content/uploads/2025/05/AMX240_200-890-0240.pdf (AMX240 Installation Manual 200-890-0240 Rev. 03, September 2026, §1.3 p.2, §2.4.8 pp.9-10, §2.12.4 p.17, §3.5 p.20, §3.10 pp.23-24, §3.11-3.12 p.24; " + SEEN + ")"],
  },

  // ---- Lightspeed headsets ----
  {
    // Shows as "Delta Zulu_####" (UG A8 p.19). Lightspeed's app records
    // "radio and intercom audio" (p.23), over the cable or "via Bluetooth"
    // (p.33), and picks among the phone's microphones (App Store notes 2.1,
    // "Manual microphone selection", and 2.2.0, "More clear naming for
    // audio recording options"). No Lightspeed document says what the headset's
    // hands-free microphone carries when a browser opens it: untested
    // either way. The headset reconnects to the last device it paired with
    // and won't force pairing while music, a call or the recorder plays
    // (pp.18, 25); the last audio app takes control (p.12).
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
      "Turn the headset on: if it isn't connected to the last device it paired with, the Bluetooth light flashes red and blue for about a minute.",
      "If it doesn't, hold the Multi-function Button for 3 seconds to force pairing (older headsets: press it 3 times). Stop music, calls and Lightspeed's recorder first, or it won't pair.",
      pickIn("Delta Zulu_ and the last four digits of its serial number"),
      "Stop Lightspeed's recorder before listening here: the last app to take the audio takes control.",
      "Lightspeed's own app records the radio over this link; whether a browser gets the radio or only your boom mic is untested.",
      GROUND_TEST,
    ],
    says: "Delta Zulu: may send the radio or only your voice; Lightspeed documents the radio only to its own app. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://web.archive.org/web/20251214082155/https://www.lightspeedaviation.com/wp-content/uploads/2024/10/LSDeltaZulu_UG_1024.pdf (Lightspeed Delta Zulu User Guide 704-00028-000.A8 10/24, pp.10-12, 18-19, 23, 25, 33-34; " + SEEN + ")",
      "https://www.flightstore.com.au/assets/files/Delta-Zulu-User-Guide-0922.pdf (Delta Zulu User Guide 704-00028-000 REV0922, pp.18-19, 23 (older: MFB pressed 3 times); " + SEEN + ")",
      "https://apps.apple.com/us/app/lightspeed-app/id1469234593 (Lightspeed App version notes 2.1, 24 Oct 2023, and 2.2.0, 18 Jul 2024; " + SEEN + ")",
    ],
  },
  {
    // Shows as "Zulu 4_#####" (UG pp.2, 12, 20). Bluetooth is off by
    // default (p.20). With DIP switch 6, Record Comms, on, "the recipient
    // of a cell phone call will hear all sounds on the intercom" (pp.11,
    // 16), so its hands-free uplink may carry the intercom, radio included;
    // Lightspeed's app records "all incoming and outgoing communications"
    // to the iPhone (p.16), and another app playing audio interrupts it
    // (p.16 note). Untested with a browser.
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
      "Turn the headset on with its power button: the green light flashes.",
      "Hold the Bluetooth button about two seconds, until it flashes red and blue and says \"Pairing Mode Enabled\". Five seconds or more turns Bluetooth off.",
      pickIn("Zulu 4_ and its number"),
      "Play no music or app sounds on this iPhone while it listens: Lightspeed says an app that plays audio interrupts Record Comms, and to run it on a second device.",
      GROUND_TEST,
      "With DIP switch 6 on, anyone you phone hears the intercom: unplug the headset from the panel for calls.",
    ],
    says: "Zulu 4: may send the intercom and radio with DIP switch 6 on; Lightspeed's own app records it, untested here. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://www.sportys.com/media/pdf/zulu4userguide.pdf (Zulu 4 User Guide 704-00037-000.A1, 7/25, pp.2, 6, 10-13, 16, 20; " + SEEN + ")",
      "https://www.lightspeedaviation.com/wp-content/uploads/2025/07/Zulu-4-User-Guide-070825.pdf (Lightspeed's own copy of 704-00037-000.A1 7/25, the Download User Guide link on its Zulu 4 support page; same text, read through the Wayback Machine's 2026-02-27 capture; " + SEEN + ")",
    ],
  },
  {
    // Shows as "PFX ####" (UG revA5 p.13; PFX Support page), "Zulu PFX
    // ####" in the first guide (A1 p.13). FlightLink's recorder "will work
    // with either the auxiliary input cable or a wireless Bluetooth
    // connection" and records "all radio and intercom communication" (UG
    // p.16); the FAQ has PFX Bluetooth "used for recording". It reconnects
    // to the most recently paired device (Support page). Untested with a
    // browser.
    id: "lightspeed-zulu-pfx",
    maker: "Lightspeed",
    model: "PFX (Zulu PFX)",
    kind: "headset",
    shows: "PFX ####",
    names: [/\bZulu[\s.]*PFX\b/i, /\bPFX[\s_-]*\d{4}\b/i, /\bLightspeed\b.*\bPFX\b/i],
    gives: "radio-maybe",
    steps: [
      ON_THE_GROUND,
      AIRPLANE_MODE,
      OTHERS_OFF,
      "Turn off Bluetooth on any iPad or phone it paired with before: it reconnects to the last one.",
      "Turn the headset on, then press its Bluetooth button for one second: the light glows blue, then flashes red and blue. An early Zulu PFX needs the button held about five seconds.",
      pickIn("PFX and the last four digits of its serial number (Zulu PFX on an early headset)"),
      "If it asks for a PIN, enter 0000.",
      "Lightspeed's FlightLink recorded the radio over this link; the headset must be plugged into the intercom.",
      "Or use its own four-conductor audio cable from the auxiliary jack on its control box into the iPhone: FlightLink records over it too. An iPhone without a headphone jack needs Apple's adapter, so test it on the ground.",
      GROUND_TEST,
    ],
    says: "Zulu PFX: sent the radio to Lightspeed's FlightLink, untested here. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://www.sportys.com/media/pdf/Zulu_PFX_User_Guide.pdf (Zulu PFX User Guide 704-00007-000.A1, 6/14, pp.13, 16-17; " + SEEN + ")",
      "https://www.lightspeedaviation.com/wp-content/uploads/2018/09/PFX_User_Guide_revA5.pdf (PFX User Guide 704-00007-000.A5, 2/17, pp.13-17; read through the Wayback Machine's capture 20251215211416; " + SEEN + ")",
      "https://rev.lightspeedaviation.com/?p=8112 (PFX Support, ©2024: \"Select PFX ####\", reconnects to the most recently paired device; " + SEEN + ")",
      LIGHTSPEED_FLIGHTLINK,
    ],
  },
  {
    // All five show as "Lightspeed-V###" (Zulu 3 support page and UG
    // pp.12-13; Zulu.2 UG pp.12-13; H-Mod UG pp.12-13; Sierra UG REV0921
    // pp.11-12; Tango UG pp.16-17), so a label can't tell them apart: one
    // entry. Lightspeed's FAQ: over Bluetooth "the 'hot mic' scenario
    // using your headset microphone", for the Zulu 3, Tango and Sierra; to
    // record, the headset's own four-conductor cable from its AUX jack, with
    // DIP switch 6 (FlightLink) on for a Zulu 2, Zulu 3 or H-Mod (each UG
    // pp.11, 14). The Zulu 2 and H-Mod follow from those siblings, so
    // "likely". Every guide warns that, set up this way, "the recipient of
    // a cell phone call will hear all sounds on the intercom", without
    // saying over the cable or Bluetooth. An older Sierra's AUX jack takes
    // "audio devices only (not cell phones)" (Sierra UG A1 p.7); older
    // Sierras and Zulu 2s need a factory retrofit (FAQ). The Tango's AUX
    // and Bluetooth are on its panel interface (Tango UG pp.6, 16-18). The
    // H-Mod has no boom mic of its own (UG p.19).
    id: "lightspeed-zulu-3-sierra-tango",
    maker: "Lightspeed",
    model: "Zulu 3, Zulu 2, Zulu H-Mod, Sierra or Tango",
    kind: "headset",
    shows: "Lightspeed-V###",
    names: [
      /\bLightspeed-V\w*/i,
      /\bZulu[\s.]?3(?!\d)/i,
      /\bZulu[\s.]?2(?!\d)/i,
      /\bZulu[\s.]*H-?Mod\b/i,
      /\bLightspeed\b.*\b(Sierra|Tango|H-?Mod)\b/i,
    ],
    gives: "voice",
    steps: [
      "Lightspeed says that over Bluetooth it sends your microphone, not the radio.",
      "For the radio, plug the headset's own audio cable from the AUX jack on its control box (on a Tango, the panel interface) into the iPhone.",
      "Another cable must be four-conductor (three black rings): a three-conductor one leaves the iPhone's microphone on.",
      "On a Zulu 2, Zulu 3 or Zulu H-Mod, set DIP switch 6 (FlightLink), the far right one, on.",
      "Turn the headset's Bluetooth off (hold its Bluetooth button about three seconds until it flashes red three times), or Bluetooth on the iPhone, as Lightspeed advises: a Bluetooth input overrides the cable.",
      "An older Sierra or Zulu 2 may need Lightspeed's FlightLink retrofit; the free FlightLink app says if yours works.",
      "Set up for the cable, anyone you phone hears the intercom: don't take calls through it.",
      "An iPhone without a headphone jack needs Apple's 3.5 mm adapter: test it on the ground.",
    ],
    says: "Lightspeed headset: hears your voice, not the radio. For the radio, use its audio cable or the audio panel's recording mode.",
    confidence: "likely",
    sources: [
      LIGHTSPEED_FLIGHTLINK,
      "https://rev.lightspeedaviation.com/?p=8108 (Zulu 3 Support, ©2024: \"Select Lightspeed-V### (numbers may vary)\"; " + SEEN + ")",
      "https://rev.lightspeedaviation.com/wp-content/uploads/2021/09/Zulu3_UG_Sept2021_V2.pdf (Zulu 3 User Guide, ©2021, pp.7, 11-14; " + SEEN + ")",
      "https://rev.lightspeedaviation.com/wp-content/uploads/2018/09/Zulu2_UG_RevA4_May2016.pdf (Zulu.2 User Guide 704-00005-000 Rev. A4 0516, pp.11-14; " + SEEN + ")",
      "https://rev.lightspeedaviation.com/wp-content/uploads/2021/11/H-Mod-User-Guide-704-00027-000.A1.pdf (Zulu H-Mod User Guide 704-00027-000 REV1021, pp.11-14, 19; " + SEEN + ")",
      "https://rev.lightspeedaviation.com/wp-content/uploads/2021/09/Sierra_UG_Sept2021_V2.pdf (Sierra User Guide 704-00001-000 REV0921, pp.8-9, 11-12, 14; " + SEEN + ")",
      "https://www.siebert.aero/media/articles/pdf/SierraUserGuide_A1.pdf (Sierra User Guide 704-00001-000 Rev. A1, ©2010, pp.7, 9, 11: older aux jack, audio only; " + SEEN + ")",
      "https://flightstore.com.au/assets/files/TANGO_UG_Sept2021_V2.pdf (Tango User Guide 704-00009-000 REV0921, pp.6, 16-18; " + SEEN + ")",
    ],
  },

  // ---- Bose headsets ----
  {
    // "When Bose A20 appears in the list of devices, select and confirm"
    // (p.19); "During flight operations, do not use the headset for
    // telephone calls" (p.i). Intercom and Bluetooth are "heard as mixed"
    // by the wearer (p.18); nothing sends the intercom to the phone
    // (pp.19-22). Sold with dual G/A, U174 or U384 plugs, or 6-pin, 5-pin
    // XLR or 8-pin panel-power plugs (p.7).
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
      "https://archive.org/download/manualsonline-id-0246f315-867e-43d5-87cd-e868088c00c8/0246f315-867e-43d5-87cd-e868088c00c8.pdf (Bose A20 Owner's Guide AM325453 Rev.07, 2012, pp.i, 7, 18-19, 22; " + SEEN + ")",
      SPORTYS_FAQ,
      NFLIGHTCAM_SPORTYS,
    ],
  },
  {
    // The device list shows "Bose A30" (p.39); "Do NOT make phone calls
    // while piloting" (p.3). In a call "intercom and phone call audio are
    // mixed" (p.45), which describes only what the wearer hears; the guide
    // never says what the phone gets. Sold with a dual plug or U174, or a
    // 5-pin XLR or 6-pin Lemo for Flex Power (p.34).
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
      "https://www.siebert.aero/media/articles/pdf/Bose_A30_Manual_english.pdf (Bose A30 Aviation Headset owner's guide, ©2023, pp.3, 34, 39, 43-45; " + SEEN + ")",
      SPORTYS_FAQ,
      NFLIGHTCAM_SPORTYS,
    ],
  },
  {
    // Both ProFlights list as "Bose ProFlight" (Series 2 guide p.34; first
    // guide p.33), so one entry; the Bose Connect app can rename it (p.11),
    // so it is recognised by "ProFlight" alone. "Do NOT make phone calls
    // while piloting" (p.3). Its only microphone is the boom (p.13);
    // "Bluetooth audio will never override the intercom" (p.35); in a call
    // "the intercom and the phone call are heard as mixed" (p.36), what the
    // wearer hears. Nothing sends the intercom or radio to the phone, and
    // it has no recording jack. Sold with dual-plug, 6-pin Lemo, 5-pin or
    // 7-pin XLR plugs (pp.30-31).
    id: "bose-proflight-2",
    maker: "Bose",
    model: "ProFlight or ProFlight Series 2",
    kind: "headset",
    shows: "Bose ProFlight",
    names: [/\bProFlight\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "Bose says not to make phone calls while piloting.", CABLE],
    says: "Bose ProFlight: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://assets.bosecreative.com/m/482a584e750830d9/original/838428_OG_PFS2-HEADSETAVIA_enUS.pdf (Bose ProFlight Series 2 Owner's Guide AM838428-0040 Rev. 00, ©2024, pp.3, 11, 13, 30-31, 34-36, 39-40; " + SEEN + ")",
      "https://assets.bosecreative.com/m/4a6919ca5adc2cc3/original/OG_PF_AviationHeadset_enUS.pdf (Bose ProFlight Owner's Guide AM802347 Rev. 02, ©2018, pp.33, 35; " + SEEN + ")",
      SPORTYS_FAQ,
      "https://www.bose.com/p/headphones-aviation-headsets/proflight-series-2-aviation-headset/PFS2-HEADSETAVIA.html (Bose ProFlight Series 2 page: Bluetooth audio mixes with the intercom; the Bose Connect app renames it; nothing on recording; " + SEEN + ")",
      NFLIGHTCAM_SPORTYS,
    ],
  },

  // ---- David Clark headsets ----
  {
    // "Select DC ONE-X" (QRG p.9), for the ONE-XP, ONE-XA and ONE-XH too,
    // which "have all the same" features; one ONE-XP, 43102G-13, has no
    // Bluetooth (p.12). Calls while plugged in are "not recommended and
    // may violate applicable regulations"; p.10 says a call sends the
    // wearer's "outbound audio", and no page sends the intercom or radio
    // to the phone. The ONE-XP has a 6-pin Redel plug (data sheet) and
    // the 43102G-04 a 5-pin XLR (p.12).
    id: "dc-one-x",
    maker: "David Clark",
    model: "DC ONE-X, ONE-XP, ONE-XA or ONE-XH",
    kind: "headset",
    shows: "DC ONE-X",
    names: [/\bDC\s*ONE-?X[PAH]?\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "David Clark doesn't recommend calls while it's plugged into the intercom.", CABLE],
    says: "DC ONE-X: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://www.davidclarkcompany.com/files/literature/230-42427%20DC%20ONE%20QRG%20Rev%2011-25.pdf (DC ONE-X Quick Reference Guide 230-42427 Rev 11-25, pp.9-10, 12; " + SEEN + ")",
      "https://www.davidclarkcompany.com/files/literature/DC-ONE-XP-Data-Sheet.pdf (DC ONE-XP data sheet: \"6-Pin Redel Plug\"; " + SEEN + ")",
      SPORTYS_FAQ,
      NFLIGHTCAM_SPORTYS,
    ],
  },
  {
    // "Select DC PRO-X2" (QRG p.7); 43105G-07 and -10 have no Bluetooth;
    // 43105G-02 is 6-pin and -04 XLR-5 (pp.5, 11); the same call wording
    // as the ONE-X (p.8).
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
      "https://www.davidclarkcompany.com/files/literature/230-42431%20DC%20PRO-X2%20QRG%20Rev%2011-25.pdf (DC PRO-X2 Quick Reference Guide 230-42431 Rev 11-25, pp.5, 7-8, 11; " + SEEN + ")",
      SPORTYS_FAQ,
      NFLIGHTCAM_SPORTYS,
    ],
  },
  {
    // The first PRO-X: "Select DC PRO-X" (manual p.7), for the PRO-XP
    // (6-pin) and PRO-XA (Airbus 5-pin) too, with "all the same advanced
    // features" (p.11); the same call wording as the ONE-X (p.8). After
    // the PRO-X2, whose name the pattern can't take ("X2" has no word
    // break), though "DC PRO-X 2" would match it.
    id: "dc-pro-x",
    maker: "David Clark",
    model: "DC PRO-X, PRO-XP or PRO-XA",
    kind: "headset",
    shows: "DC PRO-X",
    names: [/\bDC\s*PRO-?X[PA]?\b/i],
    gives: "voice",
    steps: ["Over Bluetooth it sends the phone your boom mic, not the radio.", "David Clark doesn't recommend calls while it's plugged into the intercom.", CABLE],
    says: "DC PRO-X: hears your voice, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "likely",
    sources: [
      "https://www.davidclarkcompany.com/files/literature/230-35538%20DC%20PRO-X%20Manual%20LR%20Rev%2012-18%20FINAL.pdf (DC PRO-X manual 230-35538 Rev 12-18, pp.7-8, 11; " + SEEN + ")",
      SPORTYS_FAQ,
      NFLIGHTCAM_SPORTYS,
    ],
  },

  // ---- Not connected to the airplane ----
  {
    // AirPods have no connection to the airplane's audio: "There's a
    // microphone in each AirPod" (HT207009), and their only inputs are
    // microphones (AirPods Pro 3 specifications). Once paired they are
    // named "<owner>'s AirPods" (MacRumors, 29 March 2019; Apple's own
    // pages give no default name), which the owner can change. Set to
    // Always Left or Right, an AirPod "uses the microphone even if you
    // remove it from your ear or put it in the case" (HT207009).
    id: "apple-airpods",
    maker: "Apple",
    model: "AirPods",
    kind: "headset",
    shows: null,
    names: [/\bAirPods\b/i],
    gives: "voice",
    steps: [
      "AirPods aren't connected to the airplane's audio.",
      "Disconnect them before listening to the radio: the last Bluetooth device to connect takes the input.",
      "Putting them in the case isn't enough when their microphone is set to Always Left or Always Right: disconnect them in Settings, Bluetooth.",
    ],
    says: "AirPods: hear your voice and the cabin, not the radio. For the radio, use the audio panel's recording mode or a cable.",
    confidence: "documented",
    sources: [
      "https://support.apple.com/en-us/HT207009 (Apple, Change the settings of your AirPods and AirPods Pro: \"There's a microphone in each AirPod, so you can make phone calls and use Siri\"; set to Always Left or Right, an AirPod uses the microphone \"even if you remove it from your ear or put it in the case\"; " + SEEN + ")",
      "https://www.apple.com/airpods-pro/specs/ (Apple, AirPods Pro 3 Technical Specifications: \"Dual beamforming microphones\", \"Inward-facing microphone\", no other audio input; " + SEEN + ")",
      "https://support.apple.com/guide/airpods/deva392f031a/web (Apple, Rename your AirPods; " + SEEN + ")",
      "https://www.macrumors.com/how-to/change-name-airpods/ (MacRumors, 29 March 2019: the default name \"[Your Name]'s AirPods\"; " + SEEN + ")",
    ],
  },

  // ---- Cables: a wired microphone of everything the headset hears ----
  {
    // NFlightCam's own listing: "The phone will record everything you hear
    // and say through the headset, including intercom and ATC
    // communications", "Compatible with iPhone 15" (model NF15USBC, part
    // 409C). It goes in line with the headset's headphone plug alone: one
    // "standard PJ jack" and "a female plug to connect to your headset",
    // as the 3.5 mm sibling's sheet has the 1/4-inch plugs (475K p.2). For
    // twin-plug fixed-wing headsets, not LEMO or helicopter plugs
    // (Sporty's 7718). On the iPhone it is a wired input, not HFP.
    id: "nflightcam-409c",
    maker: "NFlightCam",
    model: "Audio Cable for Smartphones, USB-C (409C)",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio",
    steps: [
      CABLE_AIRPLANE_MODE,
      "Plug the cable's plug into the airplane's headphone jack, the larger of the two, and your headset's headphone plug into the cable; the mic plug stays in its own jack. It fits standard twin-plug headsets, not LEMO or helicopter plugs.",
      "Plug its USB-C end into the iPhone (iPhone 15 and later).",
      "Disconnect Bluetooth headsets and AirPods so the cable stays the input.",
      GROUND_TEST,
    ],
    says: "NFlightCam cable: the radio comes in, with the intercom.",
    confidence: "documented",
    sources: [
      "https://www.amazon.com/dp/B0D75FQD4W (NFlightCam's own listing, sold by NFlightCam, model NF15USBC, part 409C: \"The phone will record everything you hear and say through the headset, including intercom and ATC communications\"; \"Compatible with iPhone 15\"; " + SEEN + ")",
      "https://cdn.shopify.com/s/files/1/0750/7051/files/smartphone_kit_475K.pdf (NFlightCam Smartphone Kit 475K sheet p.2: the cable's 1/4\" plug into the airplane's 1/4\" jack, the headset's 1/4\" plug into the cable; " + SEEN + ")",
      NFLIGHTCAM_SPORTYS,
    ],
  },
  {
    // Pilot Communications USA: "record all audio heard through your
    // headset", "all transmissions through the Intercom systems including
    // in-cabin and ATC transmissions", by "the 3.5 mm (4 conductor) plug"
    // into a smartphone's headset jack. The maker publishes no manual; its
    // photo shows one 1/4-inch plug and socket, so it goes in line with
    // the headphone plug only. A retailer answers that it works on an
    // iPhone 7 through Apple's Lightning adapter; nothing documents USB-C.
    id: "pilot-usa-pa-80s",
    maker: "Pilot USA",
    model: "PA-80S/iPhone",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio",
    steps: [
      CABLE_AIRPLANE_MODE,
      "Plug your headset's headphone plug (the larger one) into its socket and its own plug into the airplane's headphone jack; the microphone plug goes in as usual. Then plug its 3.5 mm plug into the iPhone through Apple's own headphone adapter.",
      "Adapters on USB-C iPhones aren't sure to work.",
      GROUND_TEST,
    ],
    says: "Pilot USA cable: the radio comes in, with the intercom, once the adapter works.",
    confidence: "test",
    sources: [
      "https://www.pilot-usa.com/adapters/recording-adapters/pa-80s-iphone.html (Pilot Communications USA, Smartphone Digital Audio Recorder Adapter, SKU PA-80S/iPhone, $75.00: \"record all audio heard through your headset\", \"all transmissions through the Intercom systems including in-cabin and ATC transmissions\"; the photo shows one 1/4-inch plug and socket and a 3.5 mm plug; no manual published; " + SEEN + ")",
      "https://www.aircraftspruce.com/catalog/pnpages/11-10531.php (Aircraft Spruce, Pilot USA PA-80S/iPhone, P/N 11-10531; its answer that it works on an iPhone 7 \"if you have the adapter to go from headphone to lightning\"; " + SEEN + ")",
    ],
  },
  {
    // In line with a twin-plug headset, "Plugging in the audio cable does
    // not sacrifice a jack"; two 3.5 mm plugs, "one for phones and one for
    // digital cameras": the TRRS one "provides a single channel microphone
    // input", the camera's is three-pole (Sporty's 27010). Sporty's says it
    // records "intercom activity", not the radio, and sells it with a USB-C
    // adapter for "phones that have a Type-C charging port" (kit B2320).
    // A LEMO version exists. No manual is published.
    id: "flight-gear-ga-audio-input",
    maker: "Flight Gear",
    model: "GA Audio Input Cable",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio",
    steps: [
      CABLE_AIRPLANE_MODE,
      "Plug the cable into the airplane's two headset jacks and your headset's two plugs into the cable.",
      "This is the twin-plug cable; a LEMO seat needs Flight Gear's LEMO version.",
      "Use its phone plug, the four-pole one, not the three-pole camera plug.",
      "On a USB-C iPhone, connect it through a USB-C to 3.5 mm adapter that takes a microphone, such as the one Sporty's sells with it.",
      "Flight Gear names no iPhone models, so check it on the ground first.",
      GROUND_TEST,
    ],
    says: "Flight Gear cable: the radio comes in, with the intercom, once the adapter works.",
    confidence: "test",
    sources: [
      "https://www.sportys.com/flight-gear-ga-audio-input-cable.html (Sporty's, Flight Gear GA Audio Input Cable, SKU 27010, $19.99: two 3.5 mm plugs, the phone's TRRS; twin plug and LEMO versions; " + SEEN + ")",
      "https://www.sportys.com/flight-gear-ga-audio-input-cable-with-gopro-and-type-c-adapter-recording-kit.html (Sporty's, Flight Gear GA Audio Input Cable with GoPro and Type C Adapter Recording Kit, SKU B2320: \"will work with camera and phones that have a Type-C charging port\"; " + SEEN + ")",
      "https://www.amazon.com/dp/B0DH92Q6X9 (Flight Gear listing: \"Made for use with standard dual GA headset plugs ... captures the audio from your intercom\"; the USB-C adapter is TRRS with \"an input for secondary microphones\"; " + SEEN + ")",
    ],
  },
  {
    // A 3.5 mm cable in line with the headset's headphone plug only
    // (PJ-055); the mic plug (PJ-068) goes to the panel (Horizon Pro
    // Pilot's Guide p.2). Appareo's app records ATC and filters the cabin
    // out, so both come through (pp.1-2). Twin GA plugs only (store).
    // Appareo says its playback fails on iPhone 12 and newer and gives no
    // reason; the Lightning adapter is inferred, not Appareo's.
    id: "appareo-stratus-audio",
    maker: "Appareo",
    model: "Stratus Audio Cable",
    kind: "cable",
    shows: null,
    names: [],
    gives: "radio-maybe",
    steps: [
      CABLE_AIRPLANE_MODE,
      "Appareo says its own app's radio playback doesn't work with this cable on iPhone 12 and later, and doesn't say why; on iPhone 15 and later the NFlightCam USB-C cable is documented instead.",
      "It fits only a headset with the two standard GA plugs, not LEMO, helicopter or airline plugs; through an adapter the panel no longer powers a noise-cancelling headset.",
      "Plug the cable's headphone plug into the airplane's headphone jack and your headset's headphone plug into the cable; the headset's microphone plug goes into the airplane as usual.",
      "On an iPhone 11 or earlier, plug its 3.5 mm end into the phone, through Apple's Lightning to 3.5 mm adapter on an iPhone 7 to 11.",
      GROUND_TEST,
    ],
    says: "Stratus Audio Cable: the radio may come in, with the intercom; Appareo's own app doesn't hear it on iPhone 12 and later. Check the words follow the ATIS.",
    confidence: "test",
    sources: [
      "https://www.appareo.com/wp-content/uploads/2018/07/600890-000065-Stratus-Horizon-Pro-Pilots-Guide.pdf (Appareo, Stratus Horizon Pro Pilot's Guide 600890-000065 rev 1.0, p.1 records ATC audio, p.2 cable connection, twin-plug note and cabin filter; " + SEEN + ")",
      "https://stratusbyappareo.com/shop2/stratus-audio-cable/ (Appareo store, Stratus Audio Cable SKU 253030-000022, $50: not on iPhone 12 and newer; GA dual fixed-wing plugs only, not LEMO, helicopter or airline; " + SEEN + ")",
      "https://appareo.com/stratus-horizon-pro-app/ (Appareo, Stratus Horizon Pro: radio transcription and playback \"does not work on ... iPhone 12 and newer\"; " + SEEN + ")",
      "https://www.aircraftspruce.com/catalog/avpages/appareo_11-19009.php (Aircraft Spruce, Appareo Stratus Audio Cable, P/N 11-19009; " + SEEN + ")",
    ],
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
