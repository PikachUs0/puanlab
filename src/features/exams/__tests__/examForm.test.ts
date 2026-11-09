import {
  DIL_AYT_UNAVAILABLE_MESSAGE,
  availableExamTypes,
  buildDefaultExamName,
  buildPracticeExam,
  changeDate,
  changeExamType,
  changeLessonCount,
  changeName,
  createFormBaseline,
  createInitialFormState,
  formatNetForDisplay,
  hasMeaningfulChanges,
  isFutureExamDate,
  toLocalDateIso,
  validateExamForm,
} from '../examForm';

/**
 * Fixed reference "now": 9 November 2026, 10:30 local. Dates are built with the
 * local `Date` constructor so the assertions do not depend on the test machine's
 * timezone.
 */
const NOW = new Date(2026, 10, 9, 10, 30, 0);
const TODAY_ISO = toLocalDateIso(NOW);

describe('add exam form rules', () => {
  it('1. generates the default exam name from the exam type and the selected date', () => {
    expect(buildDefaultExamName('TYT', TODAY_ISO)).toBe('TYT Denemesi - 9 Kasım');
    expect(buildDefaultExamName('AYT', TODAY_ISO)).toBe('AYT Denemesi - 9 Kasım');

    const initial = createInitialFormState('SAY', NOW);

    expect(initial.name).toBe('TYT Denemesi - 9 Kasım');
    expect(initial.nameIsAuto).toBe(true);
    expect(initial.date).toBe(TODAY_ISO);
  });

  it('2. rejects a future date and blocks both progression and saving', () => {
    const tomorrow = toLocalDateIso(new Date(2026, 10, 10));

    expect(isFutureExamDate(tomorrow, NOW)).toBe(true);
    expect(isFutureExamDate(TODAY_ISO, NOW)).toBe(false);

    const form = changeDate(createInitialFormState('SAY', NOW), tomorrow);
    const validation = validateExamForm(form, 'SAY', NOW);

    expect(validation.issues).toContain('date_future');
    expect(validation.canProceed).toBe(false);
    expect(validation.canSave).toBe(false);
  });

  it('3. keeps a manually edited name while the auto name follows type and date', () => {
    const autoRenamed = changeExamType(createInitialFormState('SAY', NOW), 'AYT', 'SAY');
    expect(autoRenamed.name).toBe('AYT Denemesi - 9 Kasım');

    const autoRedated = changeDate(autoRenamed, toLocalDateIso(new Date(2026, 10, 5)));
    expect(autoRedated.name).toBe('AYT Denemesi - 5 Kasım');

    let manual = changeName(createInitialFormState('SAY', NOW), '  Özdebir TYT 2  ');
    manual = changeExamType(manual, 'AYT', 'SAY');
    manual = changeDate(manual, toLocalDateIso(new Date(2026, 10, 5)));

    expect(manual.name).toBe('  Özdebir TYT 2  ');
    expect(manual.nameIsAuto).toBe(false);
  });

  it('4. reports a fresh TYT form as ready to save', () => {
    const form = createInitialFormState('SAY', NOW);
    const validation = validateExamForm(form, 'SAY', NOW);

    expect(validation.issues).toEqual([]);
    expect(validation.canProceed).toBe(true);
    expect(validation.canSave).toBe(true);
    expect(validation.lessons).toHaveLength(4);
    expect(validation.lessons.map((lesson) => lesson.questionCount)).toEqual([40, 20, 40, 20]);
    expect(validation.totals).toEqual({
      totalCorrect: 0,
      totalIncorrect: 0,
      totalBlank: 120,
      totalNet: 0,
    });
  });

  it('5. blocks saving while any section holds an invalid value', () => {
    const overTotal = changeLessonCount(createInitialFormState('SAY', NOW), 'tyt_turkce', 'correct', '41');
    const overValidation = validateExamForm(overTotal, 'SAY', NOW);

    expect(overValidation.issues).toContain('lesson_invalid');
    expect(overValidation.canSave).toBe(false);
    // Step 1 itself stays complete, so the user can go back and fix the count.
    expect(overValidation.canProceed).toBe(true);

    const decimal = changeLessonCount(createInitialFormState('SAY', NOW), 'tyt_turkce', 'correct', '3.5');
    expect(validateExamForm(decimal, 'SAY', NOW).canSave).toBe(false);

    const empty = changeLessonCount(createInitialFormState('SAY', NOW), 'tyt_turkce', 'incorrect', '');
    expect(validateExamForm(empty, 'SAY', NOW).canSave).toBe(false);

    const sumTooLarge = validateExamForm(
      changeLessonCount(
        changeLessonCount(createInitialFormState('SAY', NOW), 'tyt_turkce', 'correct', '30'),
        'tyt_turkce',
        'incorrect',
        '11',
      ),
      'SAY',
      NOW,
    );
    expect(sumTooLarge.canSave).toBe(false);
  });

  it('6. offers AYT to SAY/EA/SOZ but never to DIL', () => {
    expect(availableExamTypes('SAY')).toEqual(['TYT', 'AYT']);
    expect(availableExamTypes('EA')).toEqual(['TYT', 'AYT']);
    expect(availableExamTypes('SOZ')).toEqual(['TYT', 'AYT']);
    expect(availableExamTypes('DIL')).toEqual(['TYT']);
    expect(availableExamTypes(null)).toEqual([]);

    const dilForm = changeExamType(createInitialFormState('DIL', NOW), 'AYT', 'DIL');
    const validation = validateExamForm(dilForm, 'DIL', NOW);

    expect(validation.issues).toContain('exam_type_unavailable');
    expect(validation.canSave).toBe(false);
    expect(buildPracticeExam({ form: dilForm, scoreType: 'DIL', id: 'nope', now: NOW })).toBeNull();

    expect(DIL_AYT_UNAVAILABLE_MESSAGE).toBe(
      "DİL öğrencileri için MVP 0.1'de yalnızca TYT denemeleri destekleniyor. YDT desteği sonraki sürümlerde gelecek.",
    );
  });

  it('6b. blocks progression when the profile has no usable score type', () => {
    const validation = validateExamForm(createInitialFormState(null, NOW), null, NOW);

    expect(validation.issues).toContain('no_score_type');
    expect(validation.canProceed).toBe(false);
    expect(validation.canSave).toBe(false);
  });

  it('7. builds a complete exam whose totals are derived from the sections', () => {
    let form = createInitialFormState('SAY', NOW);
    form = changeLessonCount(form, 'tyt_turkce', 'correct', '30');
    form = changeLessonCount(form, 'tyt_turkce', 'incorrect', '4');
    form = changeLessonCount(form, 'tyt_sosyal_bilimler', 'correct', '10');
    form = changeLessonCount(form, 'tyt_sosyal_bilimler', 'incorrect', '2');
    form = changeLessonCount(form, 'tyt_temel_matematik', 'correct', '20');
    form = changeLessonCount(form, 'tyt_fen_bilimleri', 'correct', '5');
    form = changeLessonCount(form, 'tyt_fen_bilimleri', 'incorrect', '3');

    const exam = buildPracticeExam({ form, scoreType: 'SAY', id: 'exam-1', now: NOW });

    expect(exam).not.toBeNull();
    if (!exam) {
      return;
    }

    expect(exam.results).toEqual([
      { lessonId: 'tyt_turkce', correct: 30, incorrect: 4, blank: 6, net: 29 },
      { lessonId: 'tyt_sosyal_bilimler', correct: 10, incorrect: 2, blank: 8, net: 9.5 },
      { lessonId: 'tyt_temel_matematik', correct: 20, incorrect: 0, blank: 20, net: 20 },
      { lessonId: 'tyt_fen_bilimleri', correct: 5, incorrect: 3, blank: 12, net: 4.25 },
    ]);

    expect(exam.totalCorrect).toBe(65);
    expect(exam.totalIncorrect).toBe(9);
    expect(exam.totalBlank).toBe(46);
    expect(exam.totalNet).toBe(65 - 9 / 4);
    expect(exam.name).toBe('TYT Denemesi - 9 Kasım');
    expect(exam.date).toBe(TODAY_ISO);
    expect(exam.createdAt).toBe(NOW.toISOString());
    expect(exam.updatedAt).toBe(NOW.toISOString());

    // Trims the manual name and refuses to build an unsaveable form.
    const trimmed = buildPracticeExam({
      form: changeName(form, '  Deneme  '),
      scoreType: 'SAY',
      id: 'exam-2',
      now: NOW,
    });
    expect(trimmed?.name).toBe('Deneme');

    expect(
      buildPracticeExam({
        form: changeLessonCount(form, 'tyt_turkce', 'correct', '41'),
        scoreType: 'SAY',
        id: 'exam-3',
        now: NOW,
      }),
    ).toBeNull();
  });

  it('8. freezes the profile score type in scoreTypeSnapshot at creation', () => {
    const form = changeExamType(createInitialFormState('EA', NOW), 'AYT', 'EA');
    const exam = buildPracticeExam({ form, scoreType: 'EA', id: 'exam-ea', now: NOW });

    expect(exam).not.toBeNull();
    expect(exam?.type).toBe('AYT');
    expect(exam?.scoreTypeSnapshot).toBe('EA');
    expect(exam?.results.map((result) => result.lessonId)).toEqual([
      'ayt_matematik',
      'ayt_turk_dili_ve_edebiyati',
      'ayt_tarih_1',
      'ayt_cografya_1',
    ]);
  });

  it('9. protects only a form that holds meaningful changes', () => {
    const baseline = createFormBaseline('SAY', NOW);

    expect(hasMeaningfulChanges(createInitialFormState('SAY', NOW), baseline)).toBe(false);

    expect(
      hasMeaningfulChanges(changeLessonCount(createInitialFormState('SAY', NOW), 'tyt_turkce', 'correct', '1'), baseline),
    ).toBe(true);
    expect(
      hasMeaningfulChanges(changeExamType(createInitialFormState('SAY', NOW), 'AYT', 'SAY'), baseline),
    ).toBe(true);
    expect(
      hasMeaningfulChanges(changeDate(createInitialFormState('SAY', NOW), toLocalDateIso(new Date(2026, 10, 1))), baseline),
    ).toBe(true);
    expect(
      hasMeaningfulChanges(changeName(createInitialFormState('SAY', NOW), 'Kendi Denemem'), baseline),
    ).toBe(true);
  });

  it('10. formats nets with Turkish decimals and at most two places', () => {
    expect(formatNetForDisplay(29)).toBe('29');
    expect(formatNetForDisplay(33)).toBe('33');
    expect(formatNetForDisplay(9.5)).toBe('9,5');
    expect(formatNetForDisplay(62.75)).toBe('62,75');
    expect(formatNetForDisplay(-0.25)).toBe('-0,25');
  });
});
