import { describe, expect, it } from "vitest";
import type { ApproachLesson, ProcedureDrawing } from "./api/types";
import { dueWords, lessonPicked, lessonStatus, notableFixes, noteAt, notesToSend, quizScore } from "./assignedLessons";
import { lessonHref, lessonOf } from "./lessonLink";

const LESSON: ApproachLesson = {
  id: 12, studentId: 3, studentName: "Avery B. Student", instructorName: "J. J. Jones", airportIdent: "KDLH", procedureId: "I09",
  procedureName: "ILS RWY 09", cycle: "261029", fixNotes: { PYKLA: "Power to 1,800 rpm, gear down" }, dueOn: "2026-11-08",
  createdAt: "2026-10-31T18:00:00Z", updatedAt: "2026-10-31T18:00:00Z", status: "not-started", briefedAt: null, flownAt: null,
  quizAnswers: [], quizOf: null, quizAt: null, flights: [],
};
const answer = (right: boolean) => ({ question: "What's the minimum altitude at DL?", chosen: right ? "3,300 ft" : "2,700 ft", right });

describe("an assigned lesson", () => {
  it("says how far the student has come, a quiz as its score", () => {
    expect(lessonStatus(LESSON)).toBe("Not started");
    expect(lessonStatus({ ...LESSON, status: "briefed" })).toBe("Briefed");
    expect(lessonStatus({ ...LESSON, status: "flown" })).toBe("Flown");
    const all = [...Array(6)].map(() => answer(true)).concat([answer(false), answer(false)]);
    expect(lessonStatus({ ...LESSON, status: "quizzed", quizAnswers: all, quizOf: 8 })).toBe("Quiz 6 of 8");
    expect(lessonStatus({ ...LESSON, status: "quizzed", quizAnswers: [answer(true), answer(false)], quizOf: 8 })).toBe("Quiz 2 of 8 answered, 1 right");
    expect(quizScore({ quizAnswers: [answer(true), answer(false)], quizOf: 8 })).toEqual({ right: 1, answered: 2, of: 8 });
    expect(quizScore(LESSON)).toBeNull();
  });

  it("says when it is due, overdue only while its quiz is not all answered", () => {
    expect(dueWords(LESSON, "2026-11-01")).toBe("Due 8 Nov 2026");
    expect(dueWords(LESSON, "2026-11-09")).toBe("Overdue since 8 Nov 2026");
    const done = { ...LESSON, quizAnswers: [answer(true)], quizOf: 1 };
    expect(dueWords(done, "2026-11-09")).toBe("Due 8 Nov 2026");
    expect(dueWords({ ...LESSON, dueOn: null }, "2026-11-09")).toBeNull();
  });

  it("finds the instructor's note at a fix whatever its case", () => {
    expect(noteAt(LESSON.fixNotes, "pykla")).toBe("Power to 1,800 rpm, gear down");
    expect(noteAt(LESSON.fixNotes, "DL")).toBeNull();
    expect(noteAt(LESSON.fixNotes, null)).toBeNull();
    expect(notesToSend({ PYKLA: "  Gear down ", DL: "  " })).toEqual({ PYKLA: "Gear down" });
  });

  it("offers the approach's own fixes for notes, its missed approach's left out", () => {
    const fix = (ident: string, missed = false) => ({ ident, lat: 0, lon: 0, roles: [], min_ft: null, max_ft: null, speed_kt: null, missed });
    const drawing = { fixes: [fix("DL"), fix("PYKLA"), fix("RW09"), fix("CHERL", true), fix("PYKLA")] } as unknown as ProcedureDrawing;
    expect(notableFixes(drawing)).toEqual(["DL", "PYKLA", "RW09"]);
  });

  it("opens on its approach from vectors, by its own address", () => {
    expect(lessonPicked(LESSON)).toEqual({ ident: "KDLH", id: "I09", transition: null });
    expect(lessonHref(12)).toBe("/plan?lesson=12");
    expect(lessonOf("12")).toBe(12);
    expect(lessonOf("0")).toBeNull();
    expect(lessonOf("12; drop")).toBeNull();
    expect(lessonOf(null)).toBeNull();
  });
});
