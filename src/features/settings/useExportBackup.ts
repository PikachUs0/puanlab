import { useCallback, useEffect, useRef, useState } from 'react';

import { useDatabase } from '@/db';

import { exportBackupToShareSheet, ShareUnavailableError } from './backupFileIO';
import {
  endBackupOperation,
  isBackupOperationRunning,
  tryBeginBackupOperation,
} from './backupOperationLock';

export const EXPORT_BACKUP_PROGRESS_MESSAGE = 'Yedek hazırlanıyor...';
export const EXPORT_BACKUP_SUCCESS_MESSAGE = 'Yedek dosyan hazırlandı.';
export const EXPORT_BACKUP_ERROR_MESSAGE = 'Yedek oluşturulamadı. Lütfen tekrar dene.';

export type ExportBackupController = {
  /** True from the tap until the share sheet has been dismissed or failed. */
  isExporting: boolean;
  /** Localized failure message, or `null` when the last attempt did not fail. */
  error: string | null;
  /** Set only after the backup file was handed to the share sheet. */
  successMessage: string | null;
  /** Starts an export. Safe to call from a tap: duplicate calls are ignored. */
  exportBackup: () => Promise<void>;
};

/**
 * Binds the backup export to the live database connection.
 *
 * The export itself lives in `backupSnapshot.ts` / `backupFileIO.ts` (outside
 * React and outside the stores); this hook only mirrors the in-flight and
 * feedback state for the UI and prevents a simultaneous import.
 */
export function useExportBackup(): ExportBackupController {
  const { database } = useDatabase();

  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const exportBackup = useCallback(async () => {
    if (isBackupOperationRunning() || !tryBeginBackupOperation('export')) {
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsExporting(true);

    try {
      await exportBackupToShareSheet({ db: database });

      if (isMountedRef.current) {
        setSuccessMessage(EXPORT_BACKUP_SUCCESS_MESSAGE);
      }
    } catch (cause) {
      if (__DEV__) {
        console.error('[ExportBackup] Export failed', cause);
      }

      if (isMountedRef.current) {
        // A device without a share sheet gets an accurate, calm message; every
        // other failure stays generic so no technical detail reaches the UI.
        setError(
          cause instanceof ShareUnavailableError
            ? cause.message
            : EXPORT_BACKUP_ERROR_MESSAGE,
        );
      }
    } finally {
      endBackupOperation('export');

      if (isMountedRef.current) {
        setIsExporting(false);
      }
    }
  }, [database]);

  return { isExporting, error, successMessage, exportBackup };
}
