import type { Curriculum, CurriculumScoreType, ExamType, Lesson, Topic } from '@/types';

import { curriculumRepository, listAllCurricula } from './registry';
import { selectLessonById, selectLessons, selectTopicById } from './selectors';

/**
 * Curriculum access layer.
 *
 * Pure, registry-backed helpers for reading the integrated curriculum datasets.
 * React consumers should prefer the hooks in `./hooks`; these functions are the
 * non-React entry points that the hooks are built on.
 */

/** Active curriculum for an exam type and score type, or `null` when unregistered. */
export function getCurriculum(
  examType: ExamType,
  scoreType: CurriculumScoreType,
): Curriculum | null {
  return curriculumRepository.getCurriculum(examType, scoreType);
}

/** Lessons of a curriculum group (empty when the group is unregistered). */
export function getLessons(
  examType: ExamType,
  scoreType: CurriculumScoreType,
): readonly Lesson[] {
  const curriculum = getCurriculum(examType, scoreType);

  return curriculum ? selectLessons(curriculum) : [];
}

/** Lesson by its globally unique id, searched across every registered curriculum. */
export function getLessonById(lessonId: string): Lesson | null {
  for (const curriculum of listAllCurricula()) {
    const lesson = selectLessonById(curriculum, lessonId);

    if (lesson) {
      return lesson;
    }
  }

  return null;
}

/** Topics of a lesson (empty when the lesson is unknown). */
export function getTopicsByLessonId(lessonId: string): readonly Topic[] {
  return getLessonById(lessonId)?.topics ?? [];
}

/** Topic by its globally unique id, searched across every registered curriculum. */
export function getTopicById(topicId: string): Topic | null {
  for (const curriculum of listAllCurricula()) {
    const topic = selectTopicById(curriculum, topicId);

    if (topic) {
      return topic;
    }
  }

  return null;
}
