//! The parsers of what comes from outside -- METARs, TAFs, the winds
//! aloft, NOTAMs, TFR files, XML -- fed text they were never written for:
//! random strings, and real reports with their characters changed,
//! dropped and run together. None may panic; each answers or says no.

use proptest::prelude::*;
use wingtip_engine::{metar, notam, taf, tfr, winds, xml};

const NEAR: i64 = 1_793_628_000; // 2026-11-02 14:00Z

const SAMPLES: [&str; 8] = [
    "METAR KDLH 021355Z 27015G25KT 1 1/2SM -RA BR BKN008 OVC015 M02/M04 A2992 RMK AO2 T10171039",
    "SPECI KRCA 011350Z AUTO 27003KT 1/8SM R13/0400V0600FT FG BKN000 06/06 A2995 RMK AO2 SLP149",
    "METAR SBVT 021400Z 05009KT 5000 BR SCT004 OVC013 25/24 Q1016",
    "TAF KDLH 021120Z 0212/0312 27012KT P6SM BKN040 FM021800 30015G25KT 5SM -SN OVC025 TEMPO 0222/0302 2SM SN BKN012 PROB30 0304/0308 1/2SM FG VV002",
    "TAF AMD YSDU 021357Z 0213/0306 09008KT 9999 -SHRA NSC FM022200 32012KT 9999 NSW FEW040 PROB30 INTER 0215/0222 VRB20G30KT 5000 TSRA SCT080CB",
    "!ORD 10/709 ORD RWY 04L/22R CLSD EXC TAX 2610191016-2610201100EST",
    "F3298/26 NOTAMN Q) EDMM/QOLAS/IV/M /E /000/024/4820N01111E001 A) EDMM B) 2610200401 C) 2611032359 E) OBST LGT",
    "VALID 021800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000\n\nFT  3000    6000    9000   12000   18000   24000  30000\nABI      2527+17 2329+12 2337+06 2355-08 2366-21 246735\n",
];

const XML: &str = "<XNOTAM-Update><Group><Add><Not><dateEffective>2026-11-02T14:00:00</dateEffective><TfrNot><codeType>99.7</codeType></TfrNot><aseTFRArea><valDistVerUpper>180</valDistVerUpper><uomDistVerUpper>FL</uomDistVerUpper></aseTFRArea></Not></Add></Group></XNOTAM-Update>";

fn every(text: &str) {
    let _ = metar::parse(text).map(|m| metar::to_json(&m));
    let _ = taf::parse(text, NEAR).map(|t| taf::to_json(&t));
    let _ = winds::parse(text, NEAR).map(|p| winds::to_json(&p));
    let _ = notam::from_text(text);
    let _ = notam::to_json(&notam::from_fns(text));
    let _ = tfr::parse_detail(text).map(|d| tfr::to_json(&d));
    let _ = xml::parse(text);
}

/// A real sample with characters changed: each edit replaces, drops or
/// inserts one character at a place.
fn mutated(base: &'static str) -> impl Strategy<Value = String> {
    let chars: Vec<char> = base.chars().collect();
    let n = chars.len();
    prop::collection::vec((0..n.max(1), 0u8..3, any::<char>()), 1..8).prop_map(move |edits| {
        let mut c = chars.clone();
        for (at, kind, ch) in edits {
            let at = at.min(c.len());
            match kind {
                0 if at < c.len() => c[at] = ch,
                1 if at < c.len() => {
                    c.remove(at);
                }
                _ => c.insert(at, ch),
            }
        }
        c.into_iter().collect()
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 4000, ..ProptestConfig::default() })]

    #[test]
    fn random_text_never_panics(text in ".{0,300}") {
        every(&text);
    }

    #[test]
    fn report_like_words_never_panic(words in prop::collection::vec("[A-Z0-9/+\\-]{0,9}", 0..40)) {
        every(&words.join(" "));
    }

    #[test]
    fn changed_reports_never_panic(text in (0..SAMPLES.len()).prop_flat_map(|i| mutated(SAMPLES[i]))) {
        every(&text);
    }

    #[test]
    fn changed_xml_never_panics(text in mutated(XML)) {
        every(&text);
    }
}
