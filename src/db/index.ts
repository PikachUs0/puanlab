export { DatabaseProvider, useDatabase } from './DatabaseProvider';
export { getDatabase, getSchemaVersion, initializeDatabase, openDatabase } from './database';
export {
  classifyDatabaseStartupFailure,
  createDatabaseStartupController,
  DATABASE_STARTUP_COPY,
  INITIAL_DATABASE_STARTUP_STATE,
  isDatabaseUsable,
  selectDatabaseStartupGate,
  toDatabaseStartupError,
  type DatabaseStartupController,
  type DatabaseStartupFailureStage,
  type DatabaseStartupGate,
  type DatabaseStartupState,
} from './databaseStartup';
export {
  createSqliteAppSettingsRepository,
  createSqlitePracticeExamRepository,
  createSqliteTopicProgressRepository,
  createSqliteUserProfileRepository,
  type AppSettingsRepository,
  type PracticeExamRepository,
  type TopicProgressRepository,
  type UserProfileRepository,
} from './repositories';
export { DATABASE_NAME, SCHEMA_VERSION } from './schema';
