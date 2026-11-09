import { useMemo } from 'react';

import type { Curriculum, CurriculumScoreType, ExamType, Lesson, Topic } from '@/types';

import {
  getCurriculum,
  getLessonById,
  getLessons,
  getTopicById,
  getTopicsByLessonId,
} from './helpers';

/**
 * React wrappers around the curriculum access layer.
 *
 * Curriculums are static and bundled with the app, so these hooks resolve
 * synchronously and memoize their result against the input arguments.
 */

/** Active curriculum for an exam type and score type. */
export function useCurriculum(
  examType: ExamType,
  scoreType: CurriculumScoreType,
): Curriculum | null {
  return useMemo(() => getCurriculum(examType, scoreType), [examType, scoreType]);
}

/** Lessons of a curriculum group. */
export function useLessons(
  examType: ExamType,
  scoreType: CurriculumScoreType,
): readonly Lesson[] {
  return useMemo(() => getLessons(examType, scoreType), [examType, scoreType]);
}

/** Lesson by its globally unique id. */
export function useLessonById(lessonId: string): Lesson | null {
  return useMemo(() => getLessonById(lessonId), [lessonId]);
}

/** Topics of a lesson. */
export function useTopicsByLessonId(lessonId: string): readonly Topic[] {
  return useMemo(() => getTopicsByLessonId(lessonId), [lessonId]);
}

/** Topic by its globally unique id. */
export function useTopicById(topicId: string): Topic | null {
  return useMemo(() => getTopicById(topicId), [topicId]);
}
