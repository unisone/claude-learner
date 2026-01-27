/**
 * Database migrations for claude-learner v2
 */
import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      // Rules table - learned behavior guidelines
      db.exec(`
        CREATE TABLE IF NOT EXISTS rules (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          scope TEXT NOT NULL CHECK(scope IN ('global', 'project', 'file')),
          scope_target TEXT,
          state TEXT NOT NULL CHECK(state IN ('proposed', 'active', 'rejected', 'pruned')),
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          source_patterns TEXT NOT NULL DEFAULT '[]',
          opportunities INTEGER NOT NULL DEFAULT 0,
          followed INTEGER NOT NULL DEFAULT 0,
          violated INTEGER NOT NULL DEFAULT 0
        );

        -- Index for common queries
        CREATE INDEX IF NOT EXISTS idx_rules_state ON rules(state);
        CREATE INDEX IF NOT EXISTS idx_rules_scope ON rules(scope);
        CREATE INDEX IF NOT EXISTS idx_rules_scope_target ON rules(scope_target);
        CREATE INDEX IF NOT EXISTS idx_rules_state_scope ON rules(state, scope);
      `);

      // Patterns table - raw detections from session analysis
      db.exec(`
        CREATE TABLE IF NOT EXISTS patterns (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '{}',
          detected_at INTEGER NOT NULL
        );

        -- Index for session lookups and time-based queries
        CREATE INDEX IF NOT EXISTS idx_patterns_session ON patterns(session_id);
        CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
        CREATE INDEX IF NOT EXISTS idx_patterns_detected_at ON patterns(detected_at);
      `);

      // Sessions table - metadata about Claude Code sessions
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          message_count INTEGER NOT NULL DEFAULT 0
        );

        -- Index for project and time-based queries
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;
      `);

      // Migration tracking table
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'add_pattern_paths',
    up: (db) => {
      db.exec(`
        ALTER TABLE patterns ADD COLUMN project_path TEXT;
        ALTER TABLE patterns ADD COLUMN file_path TEXT;
        CREATE INDEX IF NOT EXISTS idx_patterns_project ON patterns(project_path);
      `);
    },
  },
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  // Ensure migrations table exists (bootstrap)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  // Get current version
  const currentVersion = db
    .prepare('SELECT MAX(version) as version FROM schema_migrations')
    .get() as { version: number | null };
  const appliedVersion = currentVersion?.version ?? 0;

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > appliedVersion) {
      console.log(`Running migration ${migration.version}: ${migration.name}`);

      db.transaction(() => {
        migration.up(db);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, Date.now());
      })();

      console.log(`Migration ${migration.version} complete`);
    }
  }
}

/**
 * Get current schema version
 */
export function getSchemaVersion(db: Database.Database): number {
  try {
    const result = db
      .prepare('SELECT MAX(version) as version FROM schema_migrations')
      .get() as { version: number | null };
    return result?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Check if database needs migration
 */
export function needsMigration(db: Database.Database): boolean {
  const current = getSchemaVersion(db);
  const latest = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
  return current < latest;
}

/**
 * Get latest migration version
 */
export function getLatestVersion(): number {
  return migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
}
