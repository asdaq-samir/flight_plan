package com.northflyers.vfr.domain;

/**
 * How a VOR receiver was checked for IFR, 14 CFR 91.171, with the bearing
 * error each allows: 4 degrees at an FAA VOT or a repair station's test
 * signal ((b)(1)), at a ground checkpoint on the airport ((b)(2)), and
 * between two independent receivers ((c)); 6 at an airborne checkpoint
 * ((b)(3)) or over a ground point on an airway's radial ((b)(4)).
 */
public enum VorCheck {
    VOT(4), REPAIR_STATION(4), GROUND(4), AIRBORNE(6), RADIAL(6), DUAL(4);

    private final double limitDeg;

    VorCheck(double limitDeg) {
        this.limitDeg = limitDeg;
    }

    /** The largest bearing error 91.171 allows for this check. */
    public double limitDeg() {
        return limitDeg;
    }
}
