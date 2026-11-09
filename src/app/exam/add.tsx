import { PracticeExamForm } from '@/features/exams/PracticeExamForm';

/**
 * Creates a new practice exam. The form UI and behaviour live in the shared
 * `PracticeExamForm` so the edit route can reuse them without duplication.
 */
export default function AddExamScreen() {
  return <PracticeExamForm mode="create" />;
}
