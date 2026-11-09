import type { Curriculum, Lesson, Topic } from '@/types';

/** Curriculum data is static, so these are pure selectors — no store required. */

export function selectLessons(curriculum: Curriculum): readonly Lesson[] {
  return curriculum.lessons;
}

export function selectLessonById(curriculum: Curriculum, lessonId: string): Lesson | null {
  return curriculum.lessons.find((lesson) => lesson.id === lessonId) ?? null;
}

export function selectTopicById(curriculum: Curriculum, topicId: string): Topic | null {
  for (const lesson of curriculum.lessons) {
    const topic = lesson.topics.find((item) => item.id === topicId);

    if (topic) {
      return topic;
    }
  }

  return null;
}
