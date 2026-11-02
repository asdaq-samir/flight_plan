//! The two ways the Python adds floats, kept exactly, since a route's
//! minutes are compared with each other to the last bit.

/// numpy's sum of float64 (pairwise_sum in loops_utils.h): eight running
/// sums in blocks of up to 128, halves above that.
pub fn pairwise(a: &[f64]) -> f64 {
    let n = a.len();
    if n < 8 {
        let mut res = 0.0;
        for x in a {
            res += x;
        }
        res
    } else if n <= 128 {
        let mut r = [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]];
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise(&a[..n2]) + pairwise(&a[n2..])
    }
}

/// Python's sum() of floats since 3.12: Neumaier's compensated sum.
#[derive(Default)]
pub struct Neumaier {
    f: f64,
    c: f64,
}

impl Neumaier {
    pub fn add(&mut self, x: f64) {
        let t = self.f + x;
        if self.f.abs() >= x.abs() {
            self.c += (self.f - t) + x;
        } else {
            self.c += (x - t) + self.f;
        }
        self.f = t;
    }

    pub fn value(&self) -> f64 {
        if self.c != 0.0 && self.c.is_finite() {
            self.f + self.c
        } else {
            self.f
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_sum_keeps_what_plain_addition_loses() {
        let mut s = Neumaier::default();
        for x in [1e16, 1.0, -1e16] {
            s.add(x);
        }
        assert_eq!(s.value(), 1.0);
    }

    #[test]
    fn numpy_sum_adds_in_eights() {
        let a: Vec<f64> = (0..300).map(|i| 0.1 * i as f64).collect();
        assert!((pairwise(&a) - 4485.0).abs() < 1e-9);
        assert_eq!(pairwise(&[]), 0.0);
    }
}
