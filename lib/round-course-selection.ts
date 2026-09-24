import type { Course } from "./types";

export type PendingRoundCourseSelection = {
  ok: true;
  stage: "tee";
  course: Course;
  teeOptions: Course[];
  selectedTeeId: string | null;
};

export type CompletedRoundCourseSelection = {
  ok: true;
  stage: "details";
  course: Course;
  teeOptions: Course[];
  selectedTeeId: string;
};

export type InvalidRoundCourseSelection = {
  ok: false;
  reason: "NO_USABLE_SCORECARD" | "TEE_NOT_FOUND";
};

function teeIdentity(course: Course) {
  return course.catalogTeeId || course.id;
}

function courseIdentity(course: Course) {
  return course.catalogCourseId || course.id;
}

export function preferredTeeForCourse(
  cards: readonly Course[],
  preference: { homeCourseId?: string; preferredTee?: string; preferredTeeId?: string },
) {
  if (!preference.homeCourseId) return undefined;
  const compatible = cards.filter((card) => courseIdentity(card) === preference.homeCourseId);
  if (!compatible.length) return undefined;
  if (preference.preferredTeeId) {
    const stable = compatible.find((card) => teeIdentity(card) === preference.preferredTeeId);
    if (stable) return stable;
  }
  if (!preference.preferredTee?.trim()) return undefined;
  return compatible.find((card) => card.teeName.localeCompare(preference.preferredTee!, "es-MX", { sensitivity: "base" }) === 0);
}

function hasUsableRealHoles(course: Course) {
  const numbers = course.holes
    .map(hole => Number(hole.number))
    .filter(number => Number.isInteger(number) && number >= 1 && number <= 18);
  return (numbers.length === 9 || numbers.length === 18) && new Set(numbers).size === numbers.length;
}

export function usableRoundCourseCards(cards: Course[]) {
  return cards.filter(hasUsableRealHoles);
}

export function beginRoundCourseSelection(cards: Course[]): PendingRoundCourseSelection | InvalidRoundCourseSelection {
  const teeOptions = usableRoundCourseCards(cards);
  if (!teeOptions.length) return { ok: false, reason: "NO_USABLE_SCORECARD" };
  return {
    ok: true,
    stage: "tee",
    course: teeOptions[0],
    teeOptions,
    selectedTeeId: null,
  };
}

export function changeRoundCourseSelection(currentCourse: Course | null, cards: Course[]): PendingRoundCourseSelection | InvalidRoundCourseSelection {
  const transition = beginRoundCourseSelection(cards);
  if (!transition.ok || !currentCourse) return transition;
  const currentId = teeIdentity(currentCourse);
  const compatible = transition.teeOptions.find(option => teeIdentity(option) === currentId);
  return compatible ? { ...transition, course: compatible, selectedTeeId: currentId } : transition;
}

export function completeRoundTeeSelection(
  pending: PendingRoundCourseSelection,
  selectedTeeId: string,
): CompletedRoundCourseSelection | InvalidRoundCourseSelection {
  const course = pending.teeOptions.find(option => teeIdentity(option) === selectedTeeId);
  if (!course) return { ok: false, reason: "TEE_NOT_FOUND" };
  return {
    ok: true,
    stage: "details",
    course,
    teeOptions: pending.teeOptions,
    selectedTeeId: teeIdentity(course),
  };
}
