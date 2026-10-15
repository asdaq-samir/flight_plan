package com.northflyers.vfr.domain;

/**
 * What a flight instructor's date is, as AC 61-65K's endorsements print
 * it after the certificate number: the recent experience end date of a
 * certificate without an expiration date ("RE 12-31-2026", 14 CFR
 * 61.197(a)'s 24 calendar months), or an older certificate's expiration
 * date ("Exp. 01-31-2025").
 */
public enum InstructorUntil {
    RE("RE"),
    EXP("Exp.");

    /** As the signature line writes it. */
    public final String words;

    InstructorUntil(String words) {
        this.words = words;
    }
}
