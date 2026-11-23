import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useDatabase } from '@/db';
import { useThemeControls } from '@/theme';

import { pickBackupFileText } from './backupFileIO';
import { INVALID_BACKUP_MESSAGE, parseBackupText } from './backupFormat';
import {
  endBackupOperation,
  isBackupOperationRunning,
  tryBeginBackupOperation,
} from './backupOperationLock';
import { createRestoreBackupRunner, type RestoreBackupRunner } from './restoreBackup';

export const RESTORE_BACKUP_PROGRESS_MESSAGE = 'Yedek geri yükleniyor...';
export const RESTORE_BACKUP_SUCCESS_MESSAGE = 'Yedek başarıyla geri yüklendi.';
export const RESTORE_BACKUP_ERROR_MESSAGE =
  'Yedek geri yüklenemedi. Mevcut verilerin değiştirilmedi.';

export const RESTORE_CONFIRM_TITLE = 'Yedek geri yüklensin mi?';
export const RESTORE_CONFIRM_MESSAGE =
  'Mevcut profil, konu ilerlemeleri ve denemeler yedekteki verilerle değiştirilecek.';
export const RESTORE_CONFIRM_CANCEL = 'İptal';
export const RESTORE_CONFIRM_CONTINUE = 'Devam Et';

export const RESTORE_FINAL_TITLE = 'Bu işlem mevcut verilerin üzerine yazacak';
export const RESTORE_FINAL_MESSAGE =
  'Geri yükleme başladıktan sonra işlem geri alınamaz. Devam etmek istiyor musun?';
export const RESTORE_FINAL_CANCEL = 'Vazgeç';
export const RESTORE_FINAL_CONFIRM = 'Yedeği Geri Yükle';

export type RestoreBackupController = {
  /** True from the tap until the restore (or the file selection) finishes. */
  isRestoring: boolean;
  /** Localized failure message, or `null` when the last attempt did not fail. */
  error: string | null;
  /** Set only after the restored data was committed and the stores hydrated. */
  successMessage: string | null;
  /**
   * Opens the picker, validates the selected file and only then asks for the
   * two-stage confirmation. Resolves to `true` when the data was replaced.
   */
  restoreFromBackup: () => Promise<boolean>;
};

/**
 * Two-stage destructive confirmation. Resolves `false` for every dismiss path
 * (button or tap outside) and `true` only after the final destructive action.
 */
function requestRestoreConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    let stage: 'first' | 'second' = 'first';
    let settled = false;

    const finish = (confirmed: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(confirmed);
    };

    Alert.alert(
      RESTORE_CONFIRM_TITLE,
      RESTORE_CONFIRM_MESSAGE,
      [
        { text: RESTORE_CONFIRM_CANCEL, style: 'cancel', onPress: () => finish(false) },
        {
          text: RESTORE_CONFIRM_CONTINUE,
          onPress: () => {
            // Nothing has been written yet: the second dialog decides.
            stage = 'second';

            Alert.alert(
              RESTORE_FINAL_TITLE,
              RESTORE_FINAL_MESSAGE,
              [
                { text: RESTORE_FINAL_CANCEL, style: 'cancel', onPress: () => finish(false) },
                {
                  text: RESTORE_FINAL_CONFIRM,
                  style: 'destructive',
                  onPress: () => finish(true),
                },
              ],
              {
                cancelable: true,
                onDismiss: () => {
                  if (stage === 'second') {
                    finish(false);
                  }
                },
              },
            );
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          // Android also fires this after a button press, so only a dismiss
          // that is still on the first stage cancels the flow.
          if (stage === 'first') {
            finish(false);
          }
        },
      },
    );
  });
}

/**
 * Binds the backup import to the live connection and the theme controls.
 *
 * The replacement itself lives in `restoreBackup.ts` (outside React and
 * outside the stores); this hook owns the picker, the validation and the
 * confirmation, and mirrors the in-flight and feedback state for the UI.
 */
export function useRestoreBackup(): RestoreBackupController {
  const { database } = useDatabase();
  const { applyThemePreference } = useThemeControls();

  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Created once so its single-flight flag survives re-renders.
  const [runner] = useState<RestoreBackupRunner>(() => createRestoreBackupRunner());

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const restoreFromBackup = useCallback(async (): Promise<boolean> => {
    if (isBackupOperationRunning() || runner.isRunning() || !tryBeginBackupOperation('restore')) {
      return false;
    }

    setError(null);
    setSuccessMessage(null);
    setIsRestoring(true);

    try {
      const picked = await pickBackupFileText();

      if (picked.status === 'canceled') {
        return false;
      }

      if (picked.status === 'too_large') {
        if (isMountedRef.current) {
          setError(INVALID_BACKUP_MESSAGE);
        }

        return false;
      }

      // The whole file is validated before the user is asked to confirm and
      // long before any row is deleted.
      const validation = parseBackupText(picked.text);

      if (!validation.valid) {
        if (isMountedRef.current) {
          setError(validation.message);
        }

        return false;
      }

      const confirmed = await requestRestoreConfirmation();

      if (!confirmed) {
        return false;
      }

      await runner.run({
        db: database,
        backup: validation.backup,
        applyThemePreference,
      });

      if (isMountedRef.current) {
        setSuccessMessage(RESTORE_BACKUP_SUCCESS_MESSAGE);
      }

      return true;
    } catch (cause) {
      if (__DEV__) {
        console.error('[RestoreBackup] Restore failed', cause);
      }

      if (isMountedRef.current) {
        // No parser, file-system or SQLite detail is ever surfaced.
        setError(RESTORE_BACKUP_ERROR_MESSAGE);
      }

      return false;
    } finally {
      endBackupOperation('restore');

      if (isMountedRef.current) {
        setIsRestoring(false);
      }
    }
  }, [database, applyThemePreference, runner]);

  return { isRestoring, error, successMessage, restoreFromBackup };
}
