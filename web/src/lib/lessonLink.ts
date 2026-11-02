/** The planner's address that opens an assigned lesson over the map
 *  (AssignedLesson), apart from the rest of lib/assignedLessons so that
 *  the planner's own chunk takes nothing of the lesson's. */
export const lessonHref = (id: number) => `/plan?lesson=${id}`;

/** The lesson the address names (`?lesson=12`), or none. */
export function lessonOf(param: string | null): number | null {
  const id = Number(param);
  return param && /^\d{1,12}$/.test(param) && id > 0 ? id : null;
}
