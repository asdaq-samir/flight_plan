//! The runway rules by name (crate::call lists them): each reads its input
//! as the planner's and the web's own objects in snake_case -- a runway as
//! the planner sends one (`runway_ends`, `wind`), a METAR's wind, a POH's
//! ShortField -- and answers JSON, None where the name is not one of them.

use super::circuit::{self, CircuitEnd, CircuitRunway, Pattern, Point};
use super::performance::{self, FieldReport, FitWind};
use super::pick;
use super::wind::{self, Favoured, Nearby, Reported, RunwayWind, WindPick};
use crate::gonogo::calls::{runway, runway_list, table, truth, In};
use crate::json::{self, Value};

type R<T> = Result<T, String>;

/// The rule `name` on `v`; None where the name is not a runway rule.
pub fn call(name: &str, v: &Value) -> Option<R<String>> {
    let i = In { name };
    Some(match name {
        "wind_components" => (|| {
            let (from, kt, heading) = (i.num(v, "from_deg")?, i.num(v, "kt")?, i.num(v, "heading_deg")?);
            let mut out = String::from("{\"headwind_kt\":");
            json::number(&mut out, wind::headwind_kt(from, kt, heading));
            out.push_str(",\"crosswind_kt\":");
            json::number(&mut out, wind::crosswind_kt(from, kt, heading));
            out.push('}');
            Ok(out)
        })(),
        "wind_steady_or_gust" => (|| Ok(number(wind::steady_or_gust_kt(i.num(v, "steady_kt")?, i.opt_num(v, "gust_kt")?))))(),
        "runway_crosswind" => runway_wind_of(i, v).map(|w| number(wind::runway_crosswind_kt(&w))),
        "wind_calm" => i.opt_num(v, "speed_kt").map(|s| wind::is_calm(s).to_string()),
        "runway_calm" => runway_wind_of(i, v).map(|w| wind::calm_on_runway(&w).to_string()),
        "runway_end_heading" => (|| {
            let h = wind::end_heading_true_deg(i.opt_str(v, "ident")?.as_deref(), i.opt_num(v, "heading_true_deg")?, i.num(v, "variation_deg")?);
            Ok(opt_number(h))
        })(),
        "runway_favoured_end" => (|| {
            let ends = end_headings(i, v, "ends")?;
            let found = wind::favoured_end(&ends, reported(i, v, "metar")?.as_ref(), i.num(v, "variation_deg")?, recent(i, v)?);
            Ok(favoured_json(found.as_ref()))
        })(),
        "runway_with_winds" => (|| {
            let runways = i.list(v, "runways")?.iter().map(|r| end_headings(i, r, "end_headings")).collect::<R<Vec<_>>>()?;
            let winds = wind::with_winds(&runways, reported(i, v, "metar")?.as_ref(), i.num(v, "variation_deg")?, recent(i, v)?);
            Ok(format!("[{}]", winds.iter().map(|w| favoured_json(w.as_ref())).collect::<Vec<_>>().join(",")))
        })(),
        "wind_pick" => (|| {
            let runways = runway_list(i, v, "runways")?;
            let nearby = match i.obj(v, "nearby")? {
                None => None,
                Some(n) => Some(Nearby {
                    station: i.opt_str(n, "station")?.unwrap_or_default(),
                    distance_nm: i.opt_num(n, "distance_nm")?.unwrap_or(0.0),
                    wind: Reported {
                        dir_true_deg: i.opt_num(n, "dir_true_deg")?,
                        speed_kt: i.opt_num(n, "speed_kt")?,
                        gust_kt: i.opt_num(n, "gust_kt")?,
                    },
                }),
            };
            Ok(wind_pick_json(wind::wind_pick(&runways, nearby.as_ref(), i.opt_num(v, "forecast_at")?).as_ref()))
        })(),
        "runway_end_key" => (|| Ok(string(&pick::end_key(&i.opt_str(v, "ident")?.unwrap_or_default()))))(),
        "faa_ids" => (|| {
            let mut out = String::new();
            crate::gonogo::strings(&mut out, &pick::faa_ids(&i.str(v, "ident")?));
            Ok(out)
        })(),
        "pattern_side" => (|| Ok(number(pick::pattern_side_deg(i.opt_num(v, "heading_true_deg")?, &traffic(i, v)?))))(),
        "compass_word" => (|| Ok(string(pick::compass_word(i.num(v, "bearing_deg")?))))(),
        "pattern_entry" => (|| {
            let end = i.obj(v, "end")?.map_or_else(|| i.err("end", "is missing"), Ok)?;
            let e = pick::entry_for(&i.str(end, "ident")?, i.opt_num(end, "heading_true_deg")?, &traffic(i, end)?, i.num(v, "course_deg")?);
            let mut out = String::from("{\"from\":");
            json::string(&mut out, e.from);
            out.push_str(&format!(",\"pattern_side\":{},\"words\":", e.pattern_side));
            json::string(&mut out, &e.words);
            out.push('}');
            Ok(out)
        })(),
        "pattern_exit" => (|| Ok(string(&pick::exit_for(&traffic(i, v)?))))(),
        "pattern_altitude" => (|| {
            let (agl, altitude, published) = pick::pattern_altitude(i.opt_num(v, "elevation_ft")?, i.opt_num(v, "published_agl_ft")?);
            let mut out = String::from("{\"agl_ft\":");
            json::number(&mut out, agl);
            // A whole number of feet, as the planner's int.
            out.push_str(",\"altitude_ft\":");
            out.push_str(&altitude.map_or("null".to_owned(), whole));
            out.push_str(&format!(",\"published\":{published}}}"));
            Ok(out)
        })(),
        "runway_ends_traffic" => (|| {
            let variation = i.num(v, "variation_deg")?;
            let right = i.strings(v, "right")?;
            let ends = end_headings(i, v, "end_headings")?;
            let each: Vec<String> = ends
                .iter()
                .map(|(ident, h)| {
                    let mut out = String::from("{\"ident\":");
                    json::opt_string(&mut out, ident.as_deref());
                    out.push_str(",\"heading_true_deg\":");
                    json::opt_number(&mut out, wind::end_heading_true_deg(ident.as_deref(), *h, variation));
                    out.push_str(&format!(",\"traffic\":\"{}\"}}", pick::end_traffic(ident.as_deref(), &right)));
                    out
                })
                .collect();
            Ok(format!("[{}]", each.join(",")))
        })(),
        "runway_end_fit" => end_fit_rule(i, v),
        "traffic_pattern" => (|| {
            let r = circuit_runway(i, v)?;
            Ok(pattern_json(i, v, circuit::arrival(&r, &i.str(v, "end_ident")?).as_ref())?)
        })(),
        "departure_pattern" => (|| {
            let r = circuit_runway(i, v)?;
            let toward = match i.obj(v, "toward")? {
                None => None,
                Some(t) => Some((i.num(t, "lat")?, i.num(t, "lon")?)),
            };
            Ok(pattern_json(i, v, circuit::departure(&r, &i.str(v, "end_ident")?, toward).map(|(p, _)| p).as_ref())?)
        })(),
        "arrival_circuit" => (|| {
            let r = circuit_runway(i, v)?;
            Ok(match circuit::arrival_points(&r, &i.str(v, "end_ident")?) {
                None => "null".to_owned(),
                Some(points) => format!("{{\"points\":{}}}", points_json(&points)),
            })
        })(),
        "departure_circuit" => (|| {
            let r = circuit_runway(i, v)?;
            let toward = match i.list(v, "toward")? {
                [Value::Number(lat), Value::Number(lon)] => (*lat, *lon),
                _ => return i.err("toward", "is not [lat, lon]"),
            };
            Ok(match circuit::departure_points(&r, &i.str(v, "end_ident")?, toward) {
                None => "null".to_owned(),
                Some((points, out)) => {
                    let mut s = format!("{{\"points\":{},\"exit_deg\":", points_json(&points));
                    json::number(&mut s, out);
                    s.push('}');
                    s
                }
            })
        })(),
        _ => return None,
    })
}

fn number(n: f64) -> String {
    let mut out = String::new();
    json::number(&mut out, n);
    out
}

fn opt_number(n: Option<f64>) -> String {
    let mut out = String::new();
    json::opt_number(&mut out, n);
    out
}

fn string(s: &str) -> String {
    let mut out = String::new();
    json::string(&mut out, s);
    out
}

/// A rounded figure as a whole number, as the planner's Python gives one
/// (an int, "10", not "10.0").
fn whole(n: f64) -> String {
    format!("{}", n as i64)
}

/// `{"wind": {"crosswind_kt", "headwind_kt"?, "gust_crosswind_kt"?}}`, a
/// runway's wind from the planner; the end and headwind may be left out.
fn runway_wind_of(i: In, v: &Value) -> R<RunwayWind> {
    let w = i.obj(v, "wind")?.map_or_else(|| i.err("wind", "is missing"), Ok)?;
    Ok(RunwayWind {
        end: i.opt_str(w, "end")?.unwrap_or_default(),
        headwind_kt: i.opt_num(w, "headwind_kt")?.unwrap_or(f64::NAN),
        crosswind_kt: i.num(w, "crosswind_kt")?,
        gust_crosswind_kt: i.opt_num(w, "gust_crosswind_kt")?,
        in_use: truth(w, "in_use"),
    })
}

/// A runway's ends as [ident, true heading], either null.
fn end_headings(i: In, v: &Value, key: &str) -> R<Vec<(Option<String>, Option<f64>)>> {
    i.list(v, key)?
        .iter()
        .map(|pair| match pair.as_array() {
            Some([ident, heading]) => Ok((
                match ident {
                    Value::Null => None,
                    Value::String(s) => Some(s.clone()),
                    _ => return i.err(key, "holds an ident that is not a string"),
                },
                match heading {
                    Value::Null => None,
                    Value::Number(h) => Some(*h),
                    _ => return i.err(key, "holds a heading that is not a number"),
                },
            )),
            _ => i.err(key, "holds an end that is not [ident, heading]"),
        })
        .collect()
}

/// A METAR's wind, None for none (null, missing or empty, as Python's
/// truth takes it).
fn reported(i: In, v: &Value, key: &str) -> R<Option<Reported>> {
    match i.obj(v, key)? {
        Some(m @ Value::Object(members)) if !members.is_empty() => {
            Ok(Some(Reported {
                dir_true_deg: i.opt_num(m, "wind_dir_true_deg")?,
                speed_kt: i.opt_num(m, "wind_speed_kt")?,
                gust_kt: i.opt_num(m, "wind_gust_kt")?,
            }))
        }
        _ => Ok(None),
    }
}

/// The field's last wind, `{"wind_dir_true_deg", "wind_speed_kt"}`, for a
/// calm one; None for none.
fn recent(i: In, v: &Value) -> R<Option<(f64, f64)>> {
    match i.obj(v, "recent")? {
        Some(r @ Value::Object(members)) if !members.is_empty() => {
            Ok(Some((i.num(r, "wind_dir_true_deg")?, i.num(r, "wind_speed_kt")?)))
        }
        _ => Ok(None),
    }
}

/// A favoured end as the planner's RunwayWind: the components whole
/// numbers where the wind blew, 0.0 where it was calm, and `in_use` only
/// where calm picked the runway in use.
fn favoured_json(f: Option<&Favoured>) -> String {
    let Some(f) = f else { return "null".into() };
    let mut out = String::from("{\"end\":");
    json::opt_string(&mut out, f.end.as_deref());
    let figure = |out: &mut String, n: f64| if f.calm { json::number(out, n) } else { out.push_str(&whole(n)) };
    out.push_str(",\"headwind_kt\":");
    figure(&mut out, f.headwind_kt);
    out.push_str(",\"crosswind_kt\":");
    figure(&mut out, f.crosswind_kt);
    out.push_str(",\"gust_crosswind_kt\":");
    match f.gust_crosswind_kt {
        Some(g) => figure(&mut out, g),
        None => out.push_str("null"),
    }
    if f.in_use {
        out.push_str(",\"in_use\":true");
    }
    out.push('}');
    out
}

/// A wind pick, its optional members left out where the web leaves them.
fn wind_pick_json(p: Option<&WindPick>) -> String {
    let Some(p) = p else { return "null".into() };
    let mut out = String::from("{\"ident\":");
    json::string(&mut out, &p.ident);
    out.push_str(",\"headwind_kt\":");
    json::number(&mut out, p.headwind_kt);
    out.push_str(",\"crosswind_kt\":");
    json::number(&mut out, p.crosswind_kt);
    out.push_str(",\"gust_crosswind_kt\":");
    json::opt_number(&mut out, p.gust_crosswind_kt);
    out.push_str(&format!(",\"calm\":{}", p.calm));
    if let Some(v) = p.variable_kt {
        out.push_str(",\"variable_kt\":");
        json::number(&mut out, v);
    }
    if p.in_use {
        out.push_str(",\"in_use\":true");
    }
    out.push_str(",\"from\":");
    match &p.from {
        None => out.push_str("null"),
        Some((station, nm)) => {
            out.push_str("{\"ident\":");
            json::string(&mut out, station);
            out.push_str(",\"nm\":");
            json::number(&mut out, *nm);
            out.push('}');
        }
    }
    if let Some(at) = p.forecast_at {
        out.push_str(",\"forecast_at\":");
        json::number(&mut out, at);
    }
    out.push('}');
    out
}

/// An end's traffic, "left" where it is not given (14 CFR 91.126(b)(1)).
fn traffic(i: In, v: &Value) -> R<String> {
    Ok(i.opt_str(v, "traffic")?.unwrap_or_else(|| "left".to_owned()))
}

/// `{"runway": {"length_ft"?, "runway_ends": [{"ident", "heading_true_deg"?,
/// "traffic"?, "lat"?, "lon"?}]}}`.
fn circuit_runway(i: In, v: &Value) -> R<CircuitRunway> {
    let r = i.obj(v, "runway")?.map_or_else(|| i.err("runway", "is missing"), Ok)?;
    Ok(CircuitRunway {
        length_ft: i.opt_num(r, "length_ft")?,
        ends: i
            .list(r, "runway_ends")?
            .iter()
            .map(|e| {
                Ok(CircuitEnd {
                    ident: i.opt_str(e, "ident")?.unwrap_or_default(),
                    heading_true_deg: i.opt_num(e, "heading_true_deg")?,
                    traffic: traffic(i, e)?,
                    at: match (i.opt_num(e, "lat")?, i.opt_num(e, "lon")?) {
                        (Some(lat), Some(lon)) => Some((lat, lon)),
                        _ => None,
                    },
                })
            })
            .collect::<R<_>>()?,
    })
}

fn point_json(out: &mut String, p: Point) {
    out.push_str("{\"lat\":");
    json::number(out, p.0);
    out.push_str(",\"lon\":");
    json::number(out, p.1);
    out.push('}');
}

fn points_json(points: &[Point]) -> String {
    let each: Vec<String> = points.iter().map(|p| format!("[{},{}]", number(p.0), number(p.1))).collect();
    format!("[{}]", each.join(","))
}

/// A pattern as lib/trafficPattern's TrafficPattern, in snake_case, with
/// the field's `ident` and its `altitude_ft` as given.
fn pattern_json(i: In, v: &Value, p: Option<&Pattern>) -> R<String> {
    let Some(p) = p else { return Ok("null".into()) };
    let leg = |out: &mut String, (name, from, to): &(&str, Point, Point)| {
        out.push_str("{\"name\":");
        json::string(out, name);
        out.push_str(",\"from\":");
        point_json(out, *from);
        out.push_str(",\"to\":");
        point_json(out, *to);
        out.push('}');
    };
    let mut out = format!("{{\"kind\":\"{}\",\"ident\":", if p.arrival { "arrival" } else { "departure" });
    json::string(&mut out, &i.opt_str(v, "ident")?.unwrap_or_default());
    out.push_str(",\"runway\":");
    json::string(&mut out, &p.runway);
    out.push_str(",\"traffic\":");
    json::string(&mut out, &p.traffic);
    out.push_str(",\"altitude_ft\":");
    json::opt_number(&mut out, i.opt_num(v, "altitude_ft")?);
    out.push_str(",\"legs\":[");
    for (k, l) in p.legs.iter().enumerate() {
        if k > 0 {
            out.push(',');
        }
        leg(&mut out, l);
    }
    out.push_str("],\"entry\":");
    // The entry's name last, as the web's {from, to, name}.
    let (name, from, to) = &p.entry;
    out.push_str("{\"from\":");
    point_json(&mut out, *from);
    out.push_str(",\"to\":");
    point_json(&mut out, *to);
    out.push_str(",\"name\":");
    json::string(&mut out, name);
    out.push_str("}}");
    Ok(out)
}

/// `{"aircraft"?: {"takeoff"?, "landing"?, "crosswind"?: {"demonstrated_kt"?}},
/// "runway", "end": {"heading_true_deg"?}, "wind"?: {"dir_true_deg"?,
/// "speed_kt"?, "gust_kt"?}, "elevation_ft"? (null: not known, no distance), "altimeter_in_hg"?, "temp_c"?,
/// "weight_lb"?, "kind": "takeoff"|"landing"}`.
fn end_fit_rule(i: In, v: &Value) -> R<String> {
    let aircraft = i.obj(v, "aircraft")?;
    let takeoff = i.str(v, "kind")? == "takeoff";
    let t = match aircraft.map(|a| i.obj(a, if takeoff { "takeoff" } else { "landing" })).transpose()?.flatten() {
        Some(t) => Some(table(i, t)?),
        None => None,
    };
    let demonstrated = match aircraft.map(|a| i.obj(a, "crosswind")).transpose()?.flatten() {
        Some(c) => i.opt_num(c, "demonstrated_kt")?,
        None => None,
    };
    let r = runway(i, i.obj(v, "runway")?.map_or_else(|| i.err("runway", "is missing"), Ok)?)?;
    let heading = match i.obj(v, "end")? {
        Some(e) => i.opt_num(e, "heading_true_deg")?,
        None => None,
    };
    let wind = match i.obj(v, "wind")? {
        Some(w) => Some(FitWind {
            dir_true_deg: i.opt_num(w, "dir_true_deg")?,
            speed_kt: i.opt_num(w, "speed_kt")?,
            gust_kt: i.opt_num(w, "gust_kt")?,
        }),
        None => None,
    };
    let field = FieldReport {
        elevation_ft: i.opt_num(v, "elevation_ft")?,
        altimeter_in_hg: i.opt_num(v, "altimeter_in_hg")?,
        temp_c: i.opt_num(v, "temp_c")?,
    };
    let f = performance::end_fit(t.as_ref(), demonstrated, &r, heading, wind.as_ref(), &field, i.opt_num(v, "weight_lb")?);
    let mut out = String::from("{\"crosswind_kt\":");
    json::number(&mut out, f.crosswind_kt);
    out.push_str(&format!(",\"crosswind_over\":{},\"needed_ft\":", f.crosswind_over));
    json::opt_number(&mut out, f.needed_ft);
    out.push_str(",\"length_ft\":");
    json::opt_number(&mut out, f.length_ft);
    out.push_str(&format!(",\"short\":{},\"close\":{},\"unknown\":{},\"beyond\":{}}}", f.short, f.close, f.unknown, f.beyond));
    Ok(out)
}
