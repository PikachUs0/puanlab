import type { Lesson, TopicProgress, TopicStatus } from '@/types';

import {
  selectHomeState,
  selectPriorityReviews,
  selectStaleTopics,
  selectTopicsStudiedToday,
} from '../homeSelectors';

/** Fixed reference "now": 15 March 2026, 12:00 local time. Never the real clock. */
const NOW = new Date(2026, 2, 15, 12, 0, 0);

/** ISO string `days` calendar days before NOW, at the given local hour. */
function isoDaysBefore(days: number, hour = 9): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);

  return date.toISOString();
}

/** ISO string `days` calendar days after NOW, at the given local hour. */
function isoDaysAfter(days: number, hour = 9): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);

  return date.toISOString();
}

/** ISO string for today at the given local hour. */
function isoToday(hour: number): string {
  return new Date(2026, 2, 15, hour, 0, 0).toISOString();
}

type ProgressOverrides = {
  status?: TopicStatus;
  lastStudiedAt?: string | null;
};

/** Builds a stored progress record with sensible defaults. */
function makeProgress(topicId: string, overrides: ProgressOverrides = {}): TopicProgress {
  return {
    topicId,
    status: overrides.status ?? 'learning',
    note: null,
    lastStudiedAt: overrides.lastStudiedAt ?? null,
    updatedAt: isoDaysBefore(0),
  };
}

const LESSONS: readonly Lesson[] = [
  {
    id: 'lesson-math',
    name: 'Matematik',
    topics: [
      { id: 'topic-limit', name: 'Limit' },
      { id: 'topic-turev', name: 'Türev' },
      { id: 'topic-integral', name: 'İntegral' },
    ],
  },
  {
    id: 'lesson-physics',
    name: 'Fizik',
    topics: [{ id: 'topic-force', name: 'Kuvvet' }],
  },
];

describe('selectStaleTopics thresholds', () => {
  it('1. marks a learning topic stale on the 7th calendar day', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [
        makeProgress('topic-limit', { status: 'learning', lastStudiedAt: isoDaysBefore(6) }),
        makeProgress('topic-turev', { status: 'learning', lastStudiedAt: isoDaysBefore(7) }),
      ],
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.topicId)).toEqual(['topic-turev']);
  });

  it('2. marks a practice topic stale on the 10th calendar day', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [
        makeProgress('topic-limit', { status: 'practice', lastStudiedAt: isoDaysBefore(9) }),
        makeProgress('topic-turev', { status: 'practice', lastStudiedAt: isoDaysBefore(10) }),
      ],
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.topicId)).toEqual(['topic-turev']);
  });

  it('3. marks a strong topic stale on the 45th calendar day', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [
        makeProgress('topic-limit', { status: 'strong', lastStudiedAt: isoDaysBefore(44) }),
        makeProgress('topic-turev', { status: 'strong', lastStudiedAt: isoDaysBefore(45) }),
      ],
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.topicId)).toEqual(['topic-turev']);
  });

  it('4. never lists a not_started topic as stale', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [makeProgress('topic-limit', { status: 'not_started', lastStudiedAt: isoDaysBefore(120) })],
    });

    expect(result.total).toBe(0);
  });

  it('12. never lists a topic without a study date as stale', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [makeProgress('topic-limit', { status: 'learning', lastStudiedAt: null })],
    });

    expect(result.total).toBe(0);
  });
});

describe('review handling', () => {
  it('5. always lists review topics as priority reviews', () => {
    const result = selectPriorityReviews({
      lessons: LESSONS,
      now: NOW,
      progress: [
        makeProgress('topic-limit', { status: 'review', lastStudiedAt: null }),
        makeProgress('topic-turev', { status: 'review', lastStudiedAt: isoDaysBefore(3) }),
        makeProgress('topic-integral', { status: 'learning', lastStudiedAt: isoDaysBefore(30) }),
      ],
    });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.topicId)).toEqual(['topic-limit', 'topic-turev']);
  });

  it('6. never lists a review topic as stale', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [makeProgress('topic-limit', { status: 'review', lastStudiedAt: isoDaysBefore(120) })],
    });

    expect(result.total).toBe(0);
  });

  it('7. puts a review topic without a date before dated review topics', () => {
    const result = selectPriorityReviews({
      lessons: LESSONS,
      now: NOW,
      progress: [
        makeProgress('topic-turev', { status: 'review', lastStudiedAt: isoDaysBefore(3) }),
        makeProgress('topic-limit', { status: 'review', lastStudiedAt: null }),
      ],
    });

    expect(result.items.map((item) => item.topicId)).toEqual(['topic-limit', 'topic-turev']);
  });
});

describe('ordering', () => {
  it('8. sorts the oldest study date first', () => {
    const result = selectStaleTopics({
      lessons: LESSONS,
      now: NOW,
      progress: [
        makeProgress('topic-limit', { status: 'learning', lastStudiedAt: isoDaysBefore(10) }),
        makeProgress('topic-turev', { status: 'learning', lastStudiedAt: isoDaysBefore(30) }),
        makeProgress('topic-integral', { status: 'learning', lastStudiedAt: isoDaysBefore(20) }),
      ],
    });

    expect(result.items.map((item) => item.topicId)).toEqual([
      'topic-turev',
      'topic-integral',
      'topic-limit',
    ]);
  });

  it('9. applies a deterministic Turkish-aware name tie-break', () => {
    const lessons: readonly Lesson[] = [
      {
        id: 'lesson-physics',
        name: 'Fizik',
        topics: [
          { id: 'topic-dag', name: 'Dağ' },
          { id: 'topic-cam', name: 'Çam' },
        ],
      },
    ];
    const studiedAt = isoDaysBefore(10);
    const progress = [
      makeProgress('topic-dag', { status: 'learning', lastStudiedAt: studiedAt }),
      makeProgress('topic-cam', { status: 'learning', lastStudiedAt: studiedAt }),
    ];

    const first = selectStaleTopics({ lessons, now: NOW, progress });
    const second = selectStaleTopics({ lessons, now: NOW, progress });

    // Turkish order places `Ç` before `D`, unlike a plain code-point comparison.
    expect(first.items.map((item) => item.topicName)).toEqual(['Çam', 'Dağ']);
    expect(second.items.map((item) => item.topicId)).toEqual(first.items.map((item) => item.topicId));
  });

  it('10. treats future timestamps as today', () => {
    const progress = [
      makeProgress('topic-limit', { status: 'learning', lastStudiedAt: isoDaysAfter(3) }),
    ];

    expect(selectStaleTopics({ lessons: LESSONS, now: NOW, progress }).total).toBe(0);

    const today = selectTopicsStudiedToday({ lessons: LESSONS, now: NOW, progress });
    expect(today.total).toBe(1);
    expect(today.names).toEqual(['Limit']);
  });
});

describe('invalid input handling', () => {
  it('11. does not crash the selectors on invalid timestamps', () => {
    const progress = [
      makeProgress('topic-limit', { status: 'learning', lastStudiedAt: 'not-a-date' }),
      makeProgress('topic-turev', { status: 'review', lastStudiedAt: 'not-a-date' }),
    ];

    expect(() => selectStaleTopics({ lessons: LESSONS, now: NOW, progress })).not.toThrow();
    expect(selectStaleTopics({ lessons: LESSONS, now: NOW, progress }).total).toBe(0);
    expect(selectTopicsStudiedToday({ lessons: LESSONS, now: NOW, progress }).total).toBe(0);
    // A review topic is still prioritized even when its date is unusable.
    expect(selectPriorityReviews({ lessons: LESSONS, now: NOW, progress }).total).toBe(1);
  });
});

describe('selectHomeState', () => {
  it('13. resolves no data', () => {
    expect(selectHomeState({ topicProgressCount: 0, examCount: 0 })).toBe('noData');
  });

  it('14. resolves topics only', () => {
    expect(selectHomeState({ topicProgressCount: 4, examCount: 0 })).toBe('topicsOnly');
  });

  it('15. resolves exams only', () => {
    expect(selectHomeState({ topicProgressCount: 0, examCount: 2 })).toBe('examsOnly');
  });

  it('16. resolves mixed', () => {
    expect(selectHomeState({ topicProgressCount: 2, examCount: 1 })).toBe('mixed');
  });
});

describe('selectTopicsStudiedToday', () => {
  it('17. counts and orders the topics studied today', () => {
    const lessons: readonly Lesson[] = [
      {
        id: 'lesson-math',
        name: 'Matematik',
        topics: [
          { id: 'topic-a', name: 'A Konu' },
          { id: 'topic-b', name: 'B Konu' },
          { id: 'topic-c', name: 'C Konu' },
        ],
      },
      {
        id: 'lesson-physics',
        name: 'Fizik',
        topics: [
          { id: 'topic-d', name: 'D Konu' },
          { id: 'topic-e', name: 'E Konu' },
        ],
      },
    ];

    const progress = [
      makeProgress('topic-a', { status: 'learning', lastStudiedAt: isoToday(8) }),
      makeProgress('topic-b', { status: 'learning', lastStudiedAt: isoToday(9) }),
      makeProgress('topic-c', { status: 'review', lastStudiedAt: isoToday(10) }),
      makeProgress('topic-d', { status: 'practice', lastStudiedAt: isoToday(11) }),
      makeProgress('topic-e', { status: 'learning', lastStudiedAt: isoDaysBefore(1) }),
    ];

    const result = selectTopicsStudiedToday({ lessons, now: NOW, progress });

    expect(result.total).toBe(4);
    expect(result.names).toEqual(['D Konu', 'C Konu', 'B Konu']);
  });

  it('returns an empty summary when nothing was studied today', () => {
    const result = selectTopicsStudiedToday({
      lessons: LESSONS,
      now: NOW,
      progress: [makeProgress('topic-limit', { status: 'learning', lastStudiedAt: isoDaysBefore(2) })],
    });

    expect(result.total).toBe(0);
    expect(result.names).toEqual([]);
  });
});
