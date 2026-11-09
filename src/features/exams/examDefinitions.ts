import type { ExamType, ScoreType } from '@/types';

/**
 * A single exam section (ders) of a full practice exam.
 * `lessonId` is an exam-section identifier that is intentionally independent
 * from curriculum lesson ids: exams are entered per section, while the
 * curriculum splits the same content into finer-grained lessons.
 */
export type ExamLessonDefinition = {
  lessonId: string;
  name: string;
  questionCount: number;
};

export type ExamDefinition = {
  type: ExamType;
  name: string;
  lessons: ExamLessonDefinition[];
};

/**
 * TYT full practice exam.
 * Verified question counts (2026): Türkçe 40, Sosyal Bilimler 20,
 * Temel Matematik 40, Fen Bilimleri 20 — total 120.
 */
export const TYT_EXAM_DEFINITION: ExamDefinition = {
  type: 'TYT',
  name: 'TYT Denemesi',
  lessons: [
    { lessonId: 'tyt_turkce', name: 'Türkçe', questionCount: 40 },
    { lessonId: 'tyt_sosyal_bilimler', name: 'Sosyal Bilimler', questionCount: 20 },
    { lessonId: 'tyt_temel_matematik', name: 'Temel Matematik', questionCount: 40 },
    { lessonId: 'tyt_fen_bilimleri', name: 'Fen Bilimleri', questionCount: 20 },
  ],
};

/**
 * AYT full practice exam definitions, keyed by the score types that sit an
 * AYT exam. The official AYT Matematik test carries 40 questions and includes
 * geometry, so no separate Geometri section exists here.
 *
 * Verified question counts (2026 ÖSYM AYT booklet), each worth 80 questions:
 * SAY: Matematik 40, Fizik 14, Kimya 13, Biyoloji 13.
 * EA:  Matematik 40, Türk Dili ve Edebiyatı 24, Tarih-1 10, Coğrafya-1 6.
 * SOZ: Türk Dili ve Edebiyatı 24, Tarih-1 10, Coğrafya-1 6,
 *      Tarih-2 11, Coğrafya-2 11, Felsefe Grubu 12, Din Kültürü 6.
 *
 * SOZ uses the standard Social Sciences-2 distribution. The alternative extra
 * philosophy questions offered to candidates exempt from the Religion test are
 * out of scope for MVP 0.1.
 *
 * DIL candidates sit TYT only in MVP 0.1, so no AYT definition exists for DIL
 * and no YDT definition is provided.
 */
export const AYT_EXAM_DEFINITIONS: Record<'SAY' | 'EA' | 'SOZ', ExamDefinition> = {
  SAY: {
    type: 'AYT',
    name: 'AYT Denemesi',
    lessons: [
      { lessonId: 'ayt_matematik', name: 'Matematik', questionCount: 40 },
      { lessonId: 'ayt_fizik', name: 'Fizik', questionCount: 14 },
      { lessonId: 'ayt_kimya', name: 'Kimya', questionCount: 13 },
      { lessonId: 'ayt_biyoloji', name: 'Biyoloji', questionCount: 13 },
    ],
  },
  EA: {
    type: 'AYT',
    name: 'AYT Denemesi',
    lessons: [
      { lessonId: 'ayt_matematik', name: 'Matematik', questionCount: 40 },
      { lessonId: 'ayt_turk_dili_ve_edebiyati', name: 'Türk Dili ve Edebiyatı', questionCount: 24 },
      { lessonId: 'ayt_tarih_1', name: 'Tarih-1', questionCount: 10 },
      { lessonId: 'ayt_cografya_1', name: 'Coğrafya-1', questionCount: 6 },
    ],
  },
  SOZ: {
    type: 'AYT',
    name: 'AYT Denemesi',
    lessons: [
      { lessonId: 'ayt_turk_dili_ve_edebiyati', name: 'Türk Dili ve Edebiyatı', questionCount: 24 },
      { lessonId: 'ayt_tarih_1', name: 'Tarih-1', questionCount: 10 },
      { lessonId: 'ayt_cografya_1', name: 'Coğrafya-1', questionCount: 6 },
      { lessonId: 'ayt_tarih_2', name: 'Tarih-2', questionCount: 11 },
      { lessonId: 'ayt_cografya_2', name: 'Coğrafya-2', questionCount: 11 },
      { lessonId: 'ayt_felsefe_grubu', name: 'Felsefe Grubu', questionCount: 12 },
      { lessonId: 'ayt_din_kulturu', name: 'Din Kültürü ve Ahlak Bilgisi', questionCount: 6 },
    ],
  },
};

/**
 * Resolves the exam definition for a profile score type.
 * TYT is available to every score type; AYT is resolved by score type and is
 * not offered to DIL candidates in MVP 0.1. Returns `null` when unsupported.
 */
export function getExamDefinition(examType: ExamType, scoreType: ScoreType): ExamDefinition | null {
  if (examType === 'TYT') {
    return TYT_EXAM_DEFINITION;
  }

  if (scoreType === 'DIL') {
    return null;
  }

  return AYT_EXAM_DEFINITIONS[scoreType] ?? null;
}

/** Whether a full practice exam can be created for the given score type. */
export function isExamSupported(examType: ExamType, scoreType: ScoreType): boolean {
  return getExamDefinition(examType, scoreType) !== null;
}

/** Looks up one exam section by its `lessonId`, or `null` when it is not part of the exam. */
export function getExamLessonDefinition(
  examType: ExamType,
  scoreType: ScoreType,
  lessonId: string,
): ExamLessonDefinition | null {
  const definition = getExamDefinition(examType, scoreType);

  if (!definition) {
    return null;
  }

  return definition.lessons.find((lesson) => lesson.lessonId === lessonId) ?? null;
}

/** Sum of the question counts of every section of an exam (0 when unsupported). */
export function getExamTotalQuestionCount(examType: ExamType, scoreType: ScoreType): number {
  const definition = getExamDefinition(examType, scoreType);

  if (!definition) {
    return 0;
  }

  return definition.lessons.reduce((total, lesson) => total + lesson.questionCount, 0);
}
