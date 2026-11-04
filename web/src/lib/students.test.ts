import { describe, expect, it } from "vitest";
import type { CrossCountryReview, Instructor, StudentRow } from "./api/types";
import { studentLines } from "./students";

const student = (studentId: number, name: string, soloUntil: string | null, reviewsWaiting = 0): StudentRow => ({
  linkId: studentId, studentId, name, email: `${name.toLowerCase()}@example.com`, accepted: true, askedAt: "2026-10-01T00:00:00Z",
  experienceMet: 3, experienceOf: 12, soloUntil, reviewsWaiting,
});
const review = (id: number, studentId: number, flightOn: string, level: "low" | "caution" | "high" | null): CrossCountryReview => ({
  id, studentId, studentName: "x", instructorName: null, makeModel: "Cessna 172", flightOn, note: null, askedAt: "2026-11-01T00:00:00Z",
  answeredAt: null, declinedNote: null, endorsement: null, checks: [],
  flight: {
    id, departureIdent: "C81", destinationIdent: "KMSN", stops: [], cruiseAltitudeFt: 4500, totalDistanceNm: 90, totalEteMin: 60, totalFuelGal: 8,
    aircraftTailNumber: null, altitudes: null, picks: null, plannedFor: null, createdAt: "2026-11-01T00:00:00Z",
    risk: level ? { level, score: level === "low" ? 4 : level === "caution" ? 14 : 32, factors: [] } : null,
  },
});
const base: Instructor = {
  fullName: "J. J. Jones", certificate: "987654321CFI", until: "2027-01-01", untilKind: "RE", kinds: [], signed: [], asking: [],
  students: [student(1, "Jordan", "2026-12-20", 1), student(2, "Riley", "2026-11-06"), student(3, "Sam", "2027-01-15"), student(4, "Chris", null)],
  reviews: [review(10, 1, "2026-11-04", "caution"), review(11, 3, "2026-11-12", "low")],
};

describe("an instructor's students as one list", () => {
  it("puts a flight today with a verdict and a solo endorsement lapsing within a week first", () => {
    const { needs, everyone } = studentLines(base, "2026-11-04");
    expect(needs.map(l => l.row.name)).toEqual(["Jordan", "Riley"]);
    expect(needs[0]!.needs).toEqual({ words: "Solo C81 KMSN today · Raised · 14 points", action: "Sign off" });
    expect(needs[1]!.needs).toEqual({ words: "Solo endorsement lapses in 2 days", action: "Endorse" });
    expect(everyone).toHaveLength(4);
  });

  it("gives each student two dots, their solo endorsement and the next flight's Go / No-Go", () => {
    const { everyone } = studentLines(base, "2026-11-04");
    const dots = Object.fromEntries(everyone.map(l => [l.row.name, [l.currency, l.goNoGo]]));
    expect(dots).toEqual({ Jordan: ["ok", "caution"], Riley: ["caution", "unknown"], Sam: ["ok", "ok"], Chris: ["unknown", "unknown"] });
    expect(everyone[2]!.status).toBe("C81 KMSN 12 Nov 2026 · 3 of 12 of 61.109 · solo to 15 Jan 2027 · 1 waiting on you");
  });

  it("says a lapsed endorsement and a flight gone by still waiting on a sign-off", () => {
    const { needs } = studentLines({ ...base, students: [student(2, "Riley", "2026-11-01"), student(1, "Jordan", null)] }, "2026-11-05");
    expect(needs[0]!.needs!.words).toBe("Solo endorsement lapsed 1 Nov 2026");
    expect(needs[0]!.currency).toBe("stop");
    expect(needs[1]!.needs!.words).toBe("Solo C81 KMSN 4 Nov 2026 · Raised · 14 points");
  });
});
