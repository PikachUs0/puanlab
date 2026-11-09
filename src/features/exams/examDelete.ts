/**
 * Pure helpers for deleting a practice exam.
 *
 * No React, no React Native, no Zustand, no SQLite: the exam detail screen
 * imports these so its confirmation text and its single-flight guard stay
 * unit-testable and identical everywhere they are used.
 */

/** Calm, user-facing message shown when the delete did not go through. */
export const DELETE_ERROR_MESSAGE = 'Deneme silinemedi. Lütfen tekrar dene.';

/** Title of the destructive confirmation dialog. */
export const DELETE_CONFIRM_TITLE = 'Deneme silinsin mi?';

/**
 * Confirmation body. The exam name is quoted so the dialog always names the
 * exact record that is about to be permanently removed.
 */
export function buildDeleteConfirmMessage(examName: string): string {
  return `“${examName}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`;
}

export type DeleteGuard = {
  /** Locks and returns `true` when free; returns `false` when already locked. */
  tryStart: () => boolean;
  /** Releases the lock. */
  finish: () => void;
  isInFlight: () => boolean;
};

/**
 * Synchronous single-flight guard for a destructive action.
 *
 * React state updates are asynchronous, so a rapid double tap can invoke the
 * handler twice before `isDeleting` has rendered. This guard flips a plain flag
 * synchronously, so only the first call proceeds: a second confirmation dialog
 * and a duplicate repository delete can never be started.
 */
export function createDeleteGuard(): DeleteGuard {
  let inFlight = false;

  return {
    tryStart: () => {
      if (inFlight) {
        return false;
      }

      inFlight = true;

      return true;
    },
    finish: () => {
      inFlight = false;
    },
    isInFlight: () => inFlight,
  };
}
