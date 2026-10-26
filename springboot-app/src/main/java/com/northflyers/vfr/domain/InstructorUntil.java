package com.northflyers.vfr.domain;

/**
 * What a flight instructor's date is, as AC 61-65K's endorsements print
 * it after the certificate number: the recent experience end date of a
 * certificate issued on or after December 1, 2024, which has no
 * expiration date (14 CFR 61.19(d)(1)) and whose privileges last while the
 * holder has met 61.197(b) in the preceding 24 calendar months (61.197(a))
 * ("RE 12-31-2026"); or the expiration date of one issued before then,
 * 24 calendar months from the month it was issued, renewed or reinstated
 * (61.19(d)(2), 61.197(e)) ("Exp. 01-31-2025"). Either way the date is
 * when the privileges end, which is all the app needs: it warns past it
 * and never refuses.
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
