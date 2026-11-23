import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { buildBackupFileName, MAX_BACKUP_BYTES, serializeBackup } from './backupFormat';
import { buildBackupSnapshot } from './backupSnapshot';

export const BACKUP_SHARE_DIALOG_TITLE = 'PuanLab yedeği';

/** Raised when the platform has no share sheet (e.g. a restricted device). */
export class ShareUnavailableError extends Error {
  constructor() {
    super('Bu cihazda paylaşım kullanılamıyor.');
    this.name = 'ShareUnavailableError';
  }
}

export type ExportBackupToShareSheetOptions = {
  db: SQLiteDatabase | null;
  now?: () => Date;
  appVersion?: string;
};

function writeTemporaryBackupFile(fileName: string, json: string): File {
  const file = new File(Paths.cache, fileName);

  // Overwrites a leftover file from an earlier attempt instead of failing.
  file.create({ overwrite: true });

  return file;
}

function removeTemporaryFile(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Cache clean-up is best effort; the OS clears the cache directory.
  }
}

async function shareBackupFile(file: File): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (!isAvailable) {
    throw new ShareUnavailableError();
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: BACKUP_SHARE_DIALOG_TITLE,
  });
}

/**
 * Central export operation: builds the canonical backup from SQLite, writes it
 * to a temporary cache file, opens the share sheet and removes the temporary
 * file afterwards. Nothing is uploaded and no permanent copy is kept.
 */
export async function exportBackupToShareSheet({
  db,
  now,
  appVersion,
}: ExportBackupToShareSheetOptions): Promise<void> {
  if (db === null) {
    throw new Error('Yedek oluşturulamadı: veritabanına erişilemiyor.');
  }

  // One timestamp for both `exportedAt` (UTC) and the local-date file name.
  const timestamp = now ? now() : new Date();
  const backup = await buildBackupSnapshot({
    db,
    now: () => timestamp,
    appVersion,
  });
  const fileName = buildBackupFileName(timestamp);
  const json = serializeBackup(backup);
  const file = writeTemporaryBackupFile(fileName, json);

  try {
    await file.write(json, { encoding: 'utf8' });
    await shareBackupFile(file);
  } finally {
    removeTemporaryFile(file);
  }
}

export type BackupFilePickResult =
  | { status: 'canceled' }
  | { status: 'too_large' }
  | { status: 'picked'; text: string };

/**
 * Opens the system document picker and reads the selected file as text. The
 * size check happens before the content is read into memory, so an oversized
 * file is rejected without parsing it.
 */
export async function pickBackupFileText(): Promise<BackupFilePickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) {
    return { status: 'canceled' };
  }

  const [asset] = result.assets;

  if (!asset) {
    return { status: 'canceled' };
  }

  const file = new File(asset.uri);

  if (file.size > MAX_BACKUP_BYTES) {
    return { status: 'too_large' };
  }

  const text = await file.text();

  return { status: 'picked', text };
}
