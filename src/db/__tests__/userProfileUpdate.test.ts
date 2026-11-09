/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { saveProfileUpdate, toProfileDraft } from '@/features/profile';
import type { UserProfile } from '@/types';

import { createSqliteUserProfileRepository } from '../repositories/sqliteUserProfileRepository';
import { CREATE_USER_PROFILE_TABLE } from '../schema';

type BindValue = string | number | null;

/**
 * In-memory SQLite adapter exposing exactly the `expo-sqlite` surface the
 * profile repository uses, so the real SQL runs against a real engine.
 */
class TestDatabase {
  private readonly db = new DatabaseSync(':memory:');

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: BindValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async getFirstAsync<T>(sql: string, params: BindValue[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, params: BindValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  run(sql: string): void {
    this.db.exec(sql);
  }
}

/** Deterministic fixed dates: the real clock is never read by these tests. */
const CREATED_AT = '2026-01-05T07:30:00.000Z';
const FIRST_EDIT_AT = new Date('2026-06-15T09:15:00.000Z');
const SECOND_EDIT_AT = new Date('2026-11-09T06:00:00.000Z');

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    gradeLevel: 'grade_12',
    scoreType: 'SAY',
    targetDepartment: undefined,
    targetUniversity: undefined,
    onboardingCompleted: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

let db: TestDatabase;
let repo: ReturnType<typeof createSqliteUserProfileRepository>;

beforeEach(async () => {
  db = new TestDatabase();
  await db.execAsync(CREATE_USER_PROFILE_TABLE);

  repo = createSqliteUserProfileRepository(db as unknown as SQLiteDatabase);
});

describe('profile update persistence', () => {
  it('preserves createdAt, moves updatedAt forward and trims optional fields', async () => {
    const saved = makeProfile();
    await repo.saveProfile(saved);

    const updated = await saveProfileUpdate({
      repository: repo,
      savedProfile: saved,
      draft: {
        ...toProfileDraft(saved),
        scoreType: 'EA',
        targetDepartment: '  Bilgisayar Mühendisliği  ',
        targetUniversity: 'ODTÜ',
      },
      now: FIRST_EDIT_AT,
      onSaved: () => undefined,
    });

    expect(updated.createdAt).toBe(CREATED_AT);
    expect(updated.updatedAt).toBe(FIRST_EDIT_AT.toISOString());

    const persisted = await repo.getProfile();
    expect(persisted?.createdAt).toBe(CREATED_AT);
    expect(persisted?.updatedAt).toBe(FIRST_EDIT_AT.toISOString());
    expect(persisted?.scoreType).toBe('EA');
    expect(persisted?.targetDepartment).toBe('Bilgisayar Mühendisliği');
    expect(persisted?.targetUniversity).toBe('ODTÜ');
  });

  it('updates the singleton row in place on repeated saves', async () => {
    const saved = makeProfile();
    await repo.saveProfile(saved);

    await saveProfileUpdate({
      repository: repo,
      savedProfile: saved,
      draft: { ...toProfileDraft(saved), gradeLevel: 'graduate' },
      now: FIRST_EDIT_AT,
      onSaved: () => undefined,
    });

    const afterFirstEdit = await repo.getProfile();

    await saveProfileUpdate({
      repository: repo,
      savedProfile: afterFirstEdit as UserProfile,
      draft: { ...toProfileDraft(afterFirstEdit as UserProfile), targetUniversity: 'ODTÜ' },
      now: SECOND_EDIT_AT,
      onSaved: () => undefined,
    });

    const rows = await db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM user_profile;',
    );

    expect(rows[0]?.count).toBe(1);

    const persisted = await repo.getProfile();
    expect(persisted?.createdAt).toBe(CREATED_AT);
    expect(persisted?.updatedAt).toBe(SECOND_EDIT_AT.toISOString());
    expect(persisted?.gradeLevel).toBe('graduate');
    expect(persisted?.targetUniversity).toBe('ODTÜ');
    // Unrelated exam and topic data are untouched by a profile update: only the
    // singleton profile row exists in this database.
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_profile';",
    );
    expect(tables).toHaveLength(1);
  });
});
