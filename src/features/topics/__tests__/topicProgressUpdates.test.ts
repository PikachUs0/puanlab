import type { TopicProgress, TopicStatus } from '@/types';

import {
  applyNoteChange,
  applyStatusChange,
  applyStudiedToday,
} from '../topicProgressUpdates';

const ALL_STATUSES: readonly TopicStatus[] = [
  'not_started',
  'learning',
  'practice',
  'review',
  'strong',
];

function makeProgress(overrides: Partial<TopicProgress> = {}): TopicProgress {
  return {
    topicId: 'tyt_turkce_paragraf',
    status: 'learning',
    note: 'Özet çıkardım',
    lastStudiedAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

/** A stored value is only trusted when it round-trips as a valid ISO string. */
function isIsoString(value: string | null): boolean {
  return value !== null && !Number.isNaN(new Date(value).getTime());
}

describe('applyStudiedToday ("Bugün Çalıştım")', () => {
  it('promotes a missing record to learning and stamps the study date', () => {
    const next = applyStudiedToday('tyt_turkce_paragraf', null);

    expect(next.status).toBe('learning');
    expect(isIsoString(next.lastStudiedAt)).toBe(true);
    expect(isIsoString(next.updatedAt)).toBe(true);
    // Study date and updatedAt move together on the same action.
    expect(next.lastStudiedAt).toBe(next.updatedAt);
  });

  it('promotes not_started to learning', () => {
    const next = applyStudiedToday(
      'tyt_turkce_paragraf',
      makeProgress({ status: 'not_started', lastStudiedAt: null }),
    );

    expect(next.status).toBe('learning');
    expect(isIsoString(next.lastStudiedAt)).toBe(true);
  });

  it('keeps every other status unchanged', () => {
    for (const status of ALL_STATUSES.filter((entry) => entry !== 'not_started')) {
      const next = applyStudiedToday('tyt_turkce_paragraf', makeProgress({ status }));

      expect(next.status).toBe(status);
      expect(isIsoString(next.lastStudiedAt)).toBe(true);
    }
  });

  it('leaves the note untouched', () => {
    const previous = makeProgress({ status: 'review', note: 'Zor konular' });
    const next = applyStudiedToday('tyt_turkce_paragraf', previous);

    expect(next.note).toBe('Zor konular');
  });
});

describe('applyStatusChange', () => {
  it('changes only the status and never the study date', () => {
    const previous = makeProgress({ status: 'learning' });
    const next = applyStatusChange('tyt_turkce_paragraf', previous, 'strong');

    expect(next.status).toBe('strong');
    expect(next.lastStudiedAt).toBe(previous.lastStudiedAt);
    expect(next.note).toBe(previous.note);
    expect(isIsoString(next.updatedAt)).toBe(true);
  });

  it('keeps lastStudiedAt null for a record that was never studied', () => {
    const next = applyStatusChange('tyt_turkce_paragraf', null, 'practice');

    expect(next.lastStudiedAt).toBeNull();
    expect(next.status).toBe('practice');
  });
});

describe('applyNoteChange', () => {
  it('changes only the note and preserves status and study date', () => {
    const previous = makeProgress({ status: 'practice' });
    const next = applyNoteChange('tyt_turkce_paragraf', previous, 'Formül listesi');

    expect(next.note).toBe('Formül listesi');
    expect(next.status).toBe('practice');
    expect(next.lastStudiedAt).toBe(previous.lastStudiedAt);
  });
});
