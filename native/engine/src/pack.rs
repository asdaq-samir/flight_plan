//! The cycle pack: one file per FAA cycle holding what the engine reads,
//! so the planner and the phones answer from the same bytes. The engine
//! reads it in place from a byte slice -- the caller maps the file (the
//! planner's mmap, a phone's memory-mapped Data or ByteBuffer) -- and
//! needs nothing else to.
//!
//! The format, version 1, every number little-endian:
//!
//! | Bytes   | Holds |
//! |---------|-------|
//! | 0-3     | `WTPK` |
//! | 4-7     | u32, the format's version: 1 |
//! | 8-23    | the cycle, ASCII `YYYY-MM-DD`, NUL-padded: the NASR edition's effective date |
//! | 24-31   | f64, when the pack was built, Unix seconds |
//! | 32-35   | u32, how many sections |
//! | 36-39   | u32, CRC-32 (IEEE 802.3, as zlib's crc32) of every byte from 64 to the end |
//! | 40-63   | zero |
//! | 64-     | a table, 32 bytes a section: its name (ASCII, NUL-padded to 16), its offset and its length (u64 each, from the file's start) |
//!
//! Sections start on 8-byte boundaries. A layer of shapes, `L`, is four:
//! `L.box`, each shape's box as four f64 (min lon, min lat, max lon, max
//! lat); `L.off`, n + 1 u64, where each shape's WKB starts in `L.wkb` and
//! where the last ends; `L.wkb`, the shapes as little-endian 2D WKB; and
//! `L.attr`, a UTF-8 JSON array of each shape's fields. `meta` is a JSON
//! object: the pack's sources and when each was read. wingtip.pack writes it.

pub const MAGIC: &[u8; 4] = b"WTPK";
pub const VERSION: u32 = 1;
pub const HEADER: usize = 64;
pub const ENTRY: usize = 32;

#[derive(Debug, PartialEq)]
pub enum PackError {
    NotAPack,
    Version(u32),
    CutShort,
}

pub struct Pack<'a> {
    bytes: &'a [u8],
    pub cycle: String,
    pub built_at: f64,
    pub crc32: u32,
    sections: Vec<(String, usize, usize)>,
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn u64_at(b: &[u8], o: usize) -> Option<u64> {
    b.get(o..o + 8).map(|s| u64::from_le_bytes(s.try_into().unwrap()))
}

fn f64_at(b: &[u8], o: usize) -> Option<f64> {
    b.get(o..o + 8).map(|s| f64::from_le_bytes(s.try_into().unwrap()))
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b.split(|&c| c == 0).next().unwrap_or(&[])).into_owned()
}

const fn crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = crc_table();

/// CRC-32 as zlib's crc32 gives it.
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in bytes {
        c = CRC_TABLE[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

impl<'a> Pack<'a> {
    /// The header and table read; the sections are not checked against the
    /// checksum (`verify`), which reads every byte.
    pub fn read(bytes: &'a [u8]) -> Result<Pack<'a>, PackError> {
        if bytes.len() < HEADER || &bytes[..4] != MAGIC {
            return Err(PackError::NotAPack);
        }
        let version = u32_at(bytes, 4).unwrap();
        if version != VERSION {
            return Err(PackError::Version(version));
        }
        let n = u32_at(bytes, 32).unwrap() as usize;
        let mut sections = Vec::with_capacity(n);
        for k in 0..n {
            let at = HEADER + ENTRY * k;
            let name = text(bytes.get(at..at + 16).ok_or(PackError::CutShort)?);
            let offset = u64_at(bytes, at + 16).ok_or(PackError::CutShort)? as usize;
            let length = u64_at(bytes, at + 24).ok_or(PackError::CutShort)? as usize;
            if offset.checked_add(length).is_none_or(|end| end > bytes.len()) {
                return Err(PackError::CutShort);
            }
            sections.push((name, offset, length));
        }
        Ok(Pack {
            bytes,
            cycle: text(&bytes[8..24]),
            built_at: f64_at(bytes, 24).unwrap(),
            crc32: u32_at(bytes, 36).unwrap(),
            sections,
        })
    }

    /// Whether every byte after the header is as it was written.
    pub fn verify(&self) -> bool {
        crc32(&self.bytes[HEADER..]) == self.crc32
    }

    pub fn section(&self, name: &str) -> Option<&'a [u8]> {
        self.sections.iter().find(|(n, _, _)| n == name).map(|&(_, o, l)| &self.bytes[o..o + l])
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.sections.iter().map(|(n, _, _)| n.as_str())
    }

    pub fn layer(&self, name: &str) -> Option<Layer<'a>> {
        let boxes = self.section(&format!("{name}.box"))?;
        let offsets = self.section(&format!("{name}.off"))?;
        let wkb = self.section(&format!("{name}.wkb"))?;
        let count = boxes.len() / 32;
        if offsets.len() != 8 * (count + 1) {
            return None;
        }
        Some(Layer { boxes, offsets, wkb, count })
    }
}

/// A layer's shapes: each one's box and WKB.
pub struct Layer<'a> {
    boxes: &'a [u8],
    offsets: &'a [u8],
    wkb: &'a [u8],
    pub count: usize,
}

impl<'a> Layer<'a> {
    /// (min lon, min lat, max lon, max lat).
    pub fn bbox(&self, i: usize) -> [f64; 4] {
        std::array::from_fn(|k| f64_at(self.boxes, 32 * i + 8 * k).unwrap())
    }

    pub fn wkb(&self, i: usize) -> Option<&'a [u8]> {
        let (s, e) = (u64_at(self.offsets, 8 * i)? as usize, u64_at(self.offsets, 8 * i + 8)? as usize);
        self.wkb.get(s..e)
    }

    /// Each shape, in the layer's order, whose box holds the point and
    /// whose rings (taken as a shapefile's, crate::airspace) hold it: what
    /// the airspace layer is asked at a tap. None where a shape is not
    /// WKB the engine reads.
    pub fn holding(&self, lon: f64, lat: f64) -> Option<Vec<usize>> {
        let mut out = Vec::new();
        for i in 0..self.count {
            let [w, s, e, n] = self.bbox(i);
            if w <= lon && e >= lon && s <= lat && n >= lat && crate::airspace::wkb_holds(self.wkb(i)?, lon, lat)? {
                out.push(i);
            }
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_is_zlibs() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    /// A pack of one layer, one square, written as wingtip.pack writes one.
    fn tiny() -> Vec<u8> {
        let mut wkb = vec![1u8];
        wkb.extend_from_slice(&3u32.to_le_bytes());
        wkb.extend_from_slice(&1u32.to_le_bytes());
        wkb.extend_from_slice(&5u32.to_le_bytes());
        for (x, y) in [(0.0f64, 0.0f64), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)] {
            wkb.extend_from_slice(&x.to_le_bytes());
            wkb.extend_from_slice(&y.to_le_bytes());
        }
        let mut boxes = Vec::new();
        for v in [0.0f64, 0.0, 1.0, 1.0] {
            boxes.extend_from_slice(&v.to_le_bytes());
        }
        let mut offsets = Vec::new();
        for v in [0u64, wkb.len() as u64] {
            offsets.extend_from_slice(&v.to_le_bytes());
        }
        let sections: Vec<(&str, Vec<u8>)> = vec![("a.box", boxes), ("a.off", offsets), ("a.wkb", wkb)];
        let mut body = Vec::new();
        let mut table = Vec::new();
        let start = HEADER + ENTRY * sections.len();
        for (name, data) in &sections {
            while (start + body.len()) % 8 != 0 {
                body.push(0);
            }
            let mut n = [0u8; 16];
            n[..name.len()].copy_from_slice(name.as_bytes());
            table.extend_from_slice(&n);
            table.extend_from_slice(&((start + body.len()) as u64).to_le_bytes());
            table.extend_from_slice(&(data.len() as u64).to_le_bytes());
            body.extend_from_slice(data);
        }
        let mut after = table;
        after.extend_from_slice(&body);
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        let mut cycle = [0u8; 16];
        cycle[..10].copy_from_slice(b"2026-10-30");
        out.extend_from_slice(&cycle);
        out.extend_from_slice(&1.0f64.to_le_bytes());
        out.extend_from_slice(&(sections.len() as u32).to_le_bytes());
        out.extend_from_slice(&crc32(&after).to_le_bytes());
        out.extend_from_slice(&[0u8; 24]);
        out.extend_from_slice(&after);
        out
    }

    #[test]
    fn a_pack_is_read_in_place() {
        let bytes = tiny();
        let pack = Pack::read(&bytes).unwrap();
        assert_eq!(pack.cycle, "2026-10-30");
        assert!(pack.verify());
        let layer = pack.layer("a").unwrap();
        assert_eq!(layer.count, 1);
        assert_eq!(layer.holding(0.5, 0.5), Some(vec![0]));
        assert_eq!(layer.holding(1.5, 0.5), Some(vec![]));
        let mut bad = bytes.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(!Pack::read(&bad).unwrap().verify());
        assert_eq!(Pack::read(b"nope").err(), Some(PackError::NotAPack));
    }
}
