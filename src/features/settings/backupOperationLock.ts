/**
 * A single process-wide guard shared by the export and the import flows.
 *
 * Both operations touch the same database and the same temporary cache
 * directory, so only one of them may run at a time. The UI also disables the
 * inactive action, but this lock closes the small window between a tap and the
 * next render.
 */
export type BackupOperationKind = 'export' | 'restore';

let activeOperation: BackupOperationKind | null = null;

/** True while an export or an import is already in flight. */
export function isBackupOperationRunning(): boolean {
  return activeOperation !== null;
}

/**
 * Claims the lock for `kind`. Returns `false` when another operation already
 * holds it, in which case the caller must not start its work.
 */
export function tryBeginBackupOperation(kind: BackupOperationKind): boolean {
  if (activeOperation !== null) {
    return false;
  }

  activeOperation = kind;

  return true;
}

/** Releases the lock. Only the owner can release it. */
export function endBackupOperation(kind: BackupOperationKind): void {
  if (activeOperation === kind) {
    activeOperation = null;
  }
}
