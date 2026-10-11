package com.northflyers.vfr.domain;

/**
 * The kinds of flight an inoperative instrument's or equipment's
 * determination under 14 CFR 91.213(d) was made for: what is not
 * required by day may be by night (91.205(c)) or under IFR (91.205(d)),
 * so a determination holds only for the kinds it names.
 */
public enum DeferredFor {
    /** VFR by day (91.205(b)). */
    VFR_DAY,
    /** VFR by day and at night (91.205(b), (c)). */
    VFR,
    /** Every kind, IFR among them (91.205(b)-(d)). */
    ALL
}
