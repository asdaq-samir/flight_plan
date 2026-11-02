import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AircraftProfile, LessonProgressRequest, Training } from "../../../lib/api/types";
import { api } from "../../../lib/api/client";
import { lessonPicked } from "../../../lib/assignedLessons";
import { trainingQuery } from "../../../lib/queryClient";
import ApproachLesson, { type FromInstructor } from "./ApproachLesson";

/**
 * An approach an instructor set the pilot to learn, opened over the map
 * from their Checkride page (`?lesson=12`): the same lesson as a picked
 * approach's Learn This Approach, with the instructor's notes on its
 * cards, reporting how far the pilot has come as they go (LessonService).
 * Where it is no longer theirs -- taken back, or the instructor gone --
 * it closes.
 */
export default function AssignedLesson({ id, aircraft, onClose }: {
  id: number;
  aircraft: AircraftProfile | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: training, isSuccess } = useQuery(trainingQuery);
  const lesson = training?.lessons.find(l => l.id === id) ?? null;
  useEffect(() => { if (isSuccess && !lesson) onClose(); }, [isSuccess, lesson, onClose]);
  const report = useMutation({
    mutationFn: (body: LessonProgressRequest) => api.training.lessonProgress(id, body),
    onSuccess: (next: Training) => queryClient.setQueryData(["training"], next),
  });
  const send = report.mutate;
  // Said once a lesson: Got It through the brief again, or flown again,
  // tells the instructor nothing new (the server keeps the first time).
  const said = useRef({ briefed: false, flown: false });
  const briefedAt = lesson?.briefedAt, flownAt = lesson?.flownAt;
  const once = useCallback((what: "briefed" | "flown") => {
    if (said.current[what] || (what === "briefed" ? briefedAt : flownAt)) return;
    said.current[what] = true;
    send({ briefed: what === "briefed", flown: what === "flown", quiz: null });
  }, [send, briefedAt, flownAt]);
  // One approach for as long as it is open: a new one each render took
  // the lesson off the chart (ApproachLesson ends it as `at` changes).
  const ident = lesson?.airportIdent, procedure = lesson?.procedureId;
  const at = useMemo(() => (ident && procedure ? lessonPicked({ airportIdent: ident, procedureId: procedure }) : null), [ident, procedure]);
  const from = useMemo<FromInstructor | undefined>(() => (lesson ? {
    instructorName: lesson.instructorName,
    notes: lesson.fixNotes,
    onBriefed: () => once("briefed"),
    onFlown: () => once("flown"),
    onQuiz: (answers, of) => send({ briefed: false, flown: false, quiz: { answers, of } }),
    problem: report.error ? `Your progress could not be sent to ${lesson.instructorName}: ${report.error.message}` : null,
  } : undefined), [lesson, once, send, report.error]);
  return <ApproachLesson at={at} aircraft={aircraft} onClose={onClose} from={from} />;
}
