import type { PracticeExam } from '@/types';

import { getExamDefinition } from '../examDefinitions';
import {
  buildExamUpdate,
  buildPracticeExam,
  changeDate,
  changeExamType,
  changeLessonCount,
  changeName,
  createEditBaseline,
  createEditFormState,
  createInitialFormState,
  hasEditMeaningfulChanges,
  toLocalDateIso,
} from '../examForm';

/**
 * Fixed reference "now": 9 November 2026, 10:30 local. Dates are built with the
 * local `Date` constructor so the assertions never depend on the machine's
 * timezone, and the tests never read the real clock.
 */
const NOW = new Date(2026, 10, 9, 10, 30, 0);
const LATER = new Date(2026, 10, 12, 9, 0, 0);
const TODAY_ISO = toLocalDateIso(NOW);

/** A stored TYT exam, built through the very same create path the app uses. */
function createStoredExam(): PracticeExam {
  let form = createInitialFormState('SAY', NOW);
  form = changeName(form, 'Özdebir TYT 2');
  form = changeLessonCount(form, 'tyt_turkce', 'correct', '30');
  form = changeLessonCount(form, 'tyt_turkce', 'incorrect', '4');
  form = changeLessonCount(form, 'tyt_sosyal_bilimler', 'correct', '10');

  const exam = buildPracticeExam({ form, scoreType: 'SAY', id: 'exam-1', now: NOW });

  if (!exam) {
    throw new Error('fixture exam could not be built');
  }

  return exam;
}

describe('edit practice exam rules', () => {
  it('1. converts an existing exam into the correct edit-form state', () => {
    const exam = createStoredExam();
    const state = createEditFormState(exam);

    expect(state.examType).toBe('TYT');
    expect(state.name).toBe('Özdebir TYT 2');
    expect(state.date).toBe(TODAY_ISO);
    expect(state.lessons.map((lesson) => lesson.lessonId)).toEqual([
      'tyt_turkce',
      'tyt_sosyal_bilimler',
      'tyt_temel_matematik',
      'tyt_fen_bilimleri',
    ]);
    expect(state.lessons.find((lesson) => lesson.lessonId === 'tyt_turkce')).toEqual({
      lessonId: 'tyt_turkce',
      correctText: '30',
      incorrectText: '4',
    });
    expect(state.lessons.find((lesson) => lesson.lessonId === 'tyt_sosyal_bilimler')).toEqual({
      lessonId: 'tyt_sosyal_bilimler',
      correctText: '10',
      incorrectText: '0',
    });
    // Sections with no saved answers still open as "0", never as an empty box.
    expect(state.lessons.find((lesson) => lesson.lessonId === 'tyt_fen_bilimleri')).toEqual({
      lessonId: 'tyt_fen_bilimleri',
      correctText: '0',
      incorrectText: '0',
    });
  });

  it('2./3./4. preserve id, exam type and scoreTypeSnapshot; 5. preserve createdAt', () => {
    const exam = createStoredExam();
    const form = createEditFormState(exam);
    const updated = buildExamUpdate({ form, exam, now: LATER });

    expect(updated).not.toBeNull();
    expect(updated?.id).toBe(exam.id);
    expect(updated?.type).toBe('TYT');
    expect(updated?.scoreTypeSnapshot).toBe(exam.scoreTypeSnapshot);
    expect(updated?.createdAt).toBe(exam.createdAt);
  });

  it('6. sets updatedAt to the save moment without touching createdAt', () => {
    const exam = createStoredExam();
    const updated = buildExamUpdate({ form: createEditFormState(exam), exam, now: LATER });

    expect(updated?.createdAt).toBe(NOW.toISOString());
    expect(updated?.updatedAt).toBe(LATER.toISOString());
    expect(updated?.createdAt).not.toBe(updated?.updatedAt);
  });

  it('7. treats an untouched loaded exam as not dirty', () => {
    const exam = createStoredExam();
    const form = createEditFormState(exam);
    const baseline = createEditBaseline(exam);

    expect(hasEditMeaningfulChanges(form, baseline)).toBe(false);
  });

  it('8./9. becomes dirty when the name or a section count changes', () => {
    const exam = createStoredExam();
    const form = createEditFormState(exam);
    const baseline = createEditBaseline(exam);

    expect(hasEditMeaningfulChanges(changeName(form, 'Yeni Ad'), baseline)).toBe(true);
    expect(
      hasEditMeaningfulChanges(changeLessonCount(form, 'tyt_turkce', 'correct', '31'), baseline),
    ).toBe(true);
    expect(
      hasEditMeaningfulChanges(changeLessonCount(form, 'tyt_fen_bilimleri', 'incorrect', '2'), baseline),
    ).toBe(true);
    expect(
      hasEditMeaningfulChanges(
        changeDate(form, toLocalDateIso(new Date(2026, 10, 1))),
        baseline,
      ),
    ).toBe(true);
  });

  it('10. replaces the old totals with totals recalculated from the edited sections', () => {
    const exam = createStoredExam();

    expect(exam.totalCorrect).toBe(40);
    expect(exam.totalIncorrect).toBe(4);
    expect(exam.totalBlank).toBe(76);
    expect(exam.totalNet).toBe(39);

    const form = changeLessonCount(createEditFormState(exam), 'tyt_turkce', 'correct', '32');
    const updated = buildExamUpdate({ form, exam, now: LATER });

    expect(updated?.totalCorrect).toBe(42);
    expect(updated?.totalIncorrect).toBe(4);
    expect(updated?.totalBlank).toBe(74);
    expect(updated?.totalNet).toBe(41);
    expect(updated?.results.find((result) => result.lessonId === 'tyt_turkce')).toEqual({
      lessonId: 'tyt_turkce',
      correct: 32,
      incorrect: 4,
      blank: 4,
      net: 31,
    });
    // The stale totals never survive the edit.
    expect(updated?.totalNet).not.toBe(exam.totalNet);
    expect(updated?.totalBlank).not.toBe(exam.totalBlank);
  });

  it('11. updates in place instead of creating a second exam', () => {
    const exam = createStoredExam();
    const updated = buildExamUpdate({ form: createEditFormState(exam), exam, now: LATER });

    // Same identity, same section count: an edit is never a new record.
    expect(updated?.id).toBe('exam-1');
    expect(updated?.results).toHaveLength(exam.results.length);
  });

  it('12. keeps the saved lesson structure when the profile score type changes', () => {
    // An AYT exam saved while the profile was EA.
    let eaForm = changeExamType(createInitialFormState('EA', NOW), 'AYT', 'EA');
    eaForm = changeName(eaForm, 'EA Denemesi');
    const exam = buildPracticeExam({ form: eaForm, scoreType: 'EA', id: 'exam-ea', now: NOW });

    expect(exam?.scoreTypeSnapshot).toBe('EA');

    // The profile later changes to SAY; the edit form must still resolve the
    // EA structure from the frozen snapshot, not from the new profile.
    const editState = createEditFormState(exam as PracticeExam);
    expect(editState.lessons.map((lesson) => lesson.lessonId)).toEqual([
      'ayt_matematik',
      'ayt_turk_dili_ve_edebiyati',
      'ayt_tarih_1',
      'ayt_cografya_1',
    ]);

    const sayLessonIds = getExamDefinition('AYT', 'SAY')?.lessons.map((lesson) => lesson.lessonId);
    expect(sayLessonIds).not.toEqual(editState.lessons.map((lesson) => lesson.lessonId));

    const updated = buildExamUpdate({ form: editState, exam: exam as PracticeExam, now: LATER });
    expect(updated?.scoreTypeSnapshot).toBe('EA');
    expect(updated?.results.map((result) => result.lessonId)).toEqual(
      editState.lessons.map((lesson) => lesson.lessonId),
    );
  });

  it('13. refuses to save an edit that holds an inconsistent value', () => {
    const exam = createStoredExam();
    // Türkçe has 40 questions, so 41 correct answers can never be saved.
    const inconsistent = changeLessonCount(createEditFormState(exam), 'tyt_turkce', 'correct', '41');

    expect(buildExamUpdate({ form: inconsistent, exam, now: LATER })).toBeNull();
  });
});
