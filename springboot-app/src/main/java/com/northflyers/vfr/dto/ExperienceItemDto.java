package com.northflyers.vfr.dto;

/**
 * One of 14 CFR 61.109(a)'s requirements for a private pilot's
 * aeronautical experience in an airplane: its rule, what it asks for,
 * how much of it the logbook shows ({@code have} of {@code need}, in
 * {@code unit}: "h", "landings" or "flights"), and whether that is met.
 */
public record ExperienceItemDto(String key, String rule, String label, double have, double need, String unit, boolean met) {
}
