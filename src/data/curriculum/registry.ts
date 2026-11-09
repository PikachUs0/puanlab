import type { Curriculum, CurriculumScoreType, ExamType } from '@/types';

import type { CurriculumRepository } from './curriculumRepository';
import { aytEa2026, aytSay2026, aytSoz2026, tyt2026 } from './datasets';

/**
 * Loading strategy
 * ----------------
 * Curriculums are static, versioned datasets bundled with the app (not SQLite
 * rows). Each exam type maps to its score-type groups, and each group lists its
 * versions newest-first so the first entry is the active curriculum.
 */
type CurriculumRegistry = Partial<
  Record<ExamType, Partial<Record<CurriculumScoreType, readonly Curriculum[]>>>
>;

const curriculumRegistry: CurriculumRegistry = {
  TYT: {
    ALL: [tyt2026],
  },
  AYT: {
    SAY: [aytSay2026],
    EA: [aytEa2026],
    SOZ: [aytSoz2026],
  },
};

export const curriculumRepository: CurriculumRepository = {
  getCurriculum: (examType, scoreType, version) => {
    const versions = curriculumRegistry[examType]?.[scoreType];

    if (!versions || versions.length === 0) {
      return null;
    }

    if (version === undefined) {
      return versions[0];
    }

    return versions.find((curriculum) => curriculum.version === version) ?? null;
  },
  listCurricula: (examType, scoreType) => {
    const groups = curriculumRegistry[examType];

    if (!groups) {
      return [];
    }

    if (scoreType === undefined) {
      return Object.values(groups).flatMap((versions) => versions ?? []);
    }

    return groups[scoreType] ?? [];
  },
  listCurriculumVersions: (examType, scoreType) =>
    curriculumRegistry[examType]?.[scoreType] ?? [],
};

/** Every registered curriculum across all exam types and score types. */
export function listAllCurricula(): readonly Curriculum[] {
  const curricula: Curriculum[] = [];

  for (const groups of Object.values(curriculumRegistry)) {
    if (!groups) {
      continue;
    }

    for (const versions of Object.values(groups)) {
      if (versions) {
        curricula.push(...versions);
      }
    }
  }

  return curricula;
}
