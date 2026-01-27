/**
 * SQLite database wrapper for claude-learner v2
 * Uses better-sqlite3 for synchronous, high-performance operations
 */
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { runMigrations, getSchemaVersion, getLatestVersion } from './migrations.js';
import {
  Rule,
  Pattern,
  Session,
  RuleRow,
  PatternRow,
  SessionRow,
  RuleFilter,
  PatternFilter,
  SessionFilter,
  rowToRule,
  ruleToRow,
  rowToPattern,
  patternToRow,
  rowToSession,
  sessionToRow,
  getComplianceRate,
} from './types.js';

// Default database location
const DEFAULT_DB_DIR = join(homedir(), '.claude-learner');
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'learner.db');

export class LearnerDB {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database with WAL mode for better concurrency
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    runMigrations(this.db);
  }

  /**
   * Get the underlying database instance (for advanced queries)
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Get schema version info
   */
  getVersionInfo(): { current: number; latest: number } {
    return {
      current: getSchemaVersion(this.db),
      latest: getLatestVersion(),
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ============================================
  // RULES CRUD
  // ============================================

  /**
   * Create a new rule
   */
  createRule(rule: Rule): Rule {
    const row = ruleToRow(rule);
    this.db
      .prepare(
        `INSERT INTO rules (id, text, scope, scope_target, state, created_at, last_seen_at, source_patterns, opportunities, followed, violated)
         VALUES (@id, @text, @scope, @scope_target, @state, @created_at, @last_seen_at, @source_patterns, @opportunities, @followed, @violated)`
      )
      .run(row);
    return rule;
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): Rule | null {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined;
    return row ? rowToRule(row) : null;
  }

  /**
   * Update a rule
   */
  updateRule(id: string, updates: Partial<Omit<Rule, 'id'>>): Rule | null {
    const existing = this.getRule(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    const row = ruleToRow(updated);

    this.db
      .prepare(
        `UPDATE rules SET
         text = @text,
         scope = @scope,
         scope_target = @scope_target,
         state = @state,
         created_at = @created_at,
         last_seen_at = @last_seen_at,
         source_patterns = @source_patterns,
         opportunities = @opportunities,
         followed = @followed,
         violated = @violated
         WHERE id = @id`
      )
      .run(row);

    return updated;
  }

  /**
   * Delete a rule
   */
  deleteRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get rules with optional filters
   */
  getRules(filter?: RuleFilter): Rule[] {
    let sql = 'SELECT * FROM rules WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (filter?.scope) {
      sql += ' AND scope = @scope';
      params.scope = filter.scope;
    }

    if (filter?.scopeTarget) {
      sql += ' AND scope_target = @scopeTarget';
      params.scopeTarget = filter.scopeTarget;
    }

    if (filter?.state) {
      sql += ' AND state = @state';
      params.state = filter.state;
    }

    if (filter?.states && filter.states.length > 0) {
      const placeholders = filter.states.map((_, i) => `@state${i}`).join(', ');
      sql += ` AND state IN (${placeholders})`;
      filter.states.forEach((s, i) => {
        params[`state${i}`] = s;
      });
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(params) as RuleRow[];
    return rows.map(rowToRule);
  }

  /**
   * Get active rules for a context (global + matching project/file)
   */
  getActiveRulesForContext(projectPath?: string, filePath?: string): Rule[] {
    const rules: Rule[] = [];

    // Get global rules
    const globalRules = this.getRules({ state: 'active', scope: 'global' });
    rules.push(...globalRules);

    // Get project rules
    if (projectPath) {
      const projectRules = this.getRules({
        state: 'active',
        scope: 'project',
        scopeTarget: projectPath,
      });
      rules.push(...projectRules);
    }

    // Get file rules
    if (filePath) {
      const fileRules = this.getRules({
        state: 'active',
        scope: 'file',
        scopeTarget: filePath,
      });
      rules.push(...fileRules);
    }

    return rules;
  }

  /**
   * Get proposed rules (pending approval)
   */
  getProposedRules(): Rule[] {
    return this.getRules({ state: 'proposed' });
  }

  /**
   * Approve a rule (proposed → active)
   */
  approveRule(id: string): Rule | null {
    return this.updateRule(id, { state: 'active' });
  }

  /**
   * Reject a rule (proposed → rejected)
   */
  rejectRule(id: string): Rule | null {
    return this.updateRule(id, { state: 'rejected' });
  }

  /**
   * Prune a rule (active → pruned)
   */
  pruneRule(id: string): Rule | null {
    return this.updateRule(id, { state: 'pruned' });
  }

  /**
   * Record that a rule was followed
   */
  recordRuleFollowed(id: string): Rule | null {
    const rule = this.getRule(id);
    if (!rule) return null;

    return this.updateRule(id, {
      opportunities: rule.opportunities + 1,
      followed: rule.followed + 1,
      lastSeenAt: Date.now(),
    });
  }

  /**
   * Record that a rule was violated
   */
  recordRuleViolated(id: string): Rule | null {
    const rule = this.getRule(id);
    if (!rule) return null;

    return this.updateRule(id, {
      opportunities: rule.opportunities + 1,
      violated: rule.violated + 1,
      lastSeenAt: Date.now(),
    });
  }

  /**
   * Get rules that should be pruned (low compliance)
   */
  getRulesForPruning(minOpportunities: number = 10, maxComplianceRate: number = 0.3): Rule[] {
    const activeRules = this.getRules({ state: 'active' });
    return activeRules.filter(
      (rule) =>
        rule.opportunities >= minOpportunities && getComplianceRate(rule) < maxComplianceRate
    );
  }

  // ============================================
  // PATTERNS CRUD
  // ============================================

  /**
   * Create a new pattern
   */
  createPattern(pattern: Pattern): Pattern {
    const row = patternToRow(pattern);
    this.db
      .prepare(
        `INSERT INTO patterns (id, session_id, type, content, context, project_path, file_path, detected_at)
         VALUES (@id, @session_id, @type, @content, @context, @project_path, @file_path, @detected_at)`
      )
      .run(row);
    return pattern;
  }

  /**
   * Get a pattern by ID
   */
  getPattern(id: string): Pattern | null {
    const row = this.db
      .prepare('SELECT * FROM patterns WHERE id = ?')
      .get(id) as PatternRow | undefined;
    return row ? rowToPattern(row) : null;
  }

  /**
   * Delete a pattern
   */
  deletePattern(id: string): boolean {
    const result = this.db.prepare('DELETE FROM patterns WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get patterns with optional filters
   */
  getPatterns(filter?: PatternFilter): Pattern[] {
    let sql = 'SELECT * FROM patterns WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (filter?.sessionId) {
      sql += ' AND session_id = @sessionId';
      params.sessionId = filter.sessionId;
    }

    if (filter?.type) {
      sql += ' AND type = @type';
      params.type = filter.type;
    }

    if (filter?.since) {
      sql += ' AND detected_at >= @since';
      params.since = filter.since;
    }

    sql += ' ORDER BY detected_at DESC';

    const rows = this.db.prepare(sql).all(params) as PatternRow[];
    return rows.map(rowToPattern);
  }

  /**
   * Get patterns for a session
   */
  getPatternsForSession(sessionId: string): Pattern[] {
    return this.getPatterns({ sessionId });
  }

  /**
   * Count patterns by type
   */
  countPatternsByType(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT type, COUNT(*) as count FROM patterns GROUP BY type')
      .all() as { type: string; count: number }[];

    return rows.reduce(
      (acc, row) => {
        acc[row.type] = row.count;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  // ============================================
  // SESSIONS CRUD
  // ============================================

  /**
   * Create a new session
   */
  createSession(session: Session): Session {
    const row = sessionToRow(session);
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_path, started_at, ended_at, message_count)
         VALUES (@id, @project_path, @started_at, @ended_at, @message_count)`
      )
      .run(row);
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  /**
   * Update a session
   */
  updateSession(id: string, updates: Partial<Omit<Session, 'id'>>): Session | null {
    const existing = this.getSession(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    const row = sessionToRow(updated);

    this.db
      .prepare(
        `UPDATE sessions SET
         project_path = @project_path,
         started_at = @started_at,
         ended_at = @ended_at,
         message_count = @message_count
         WHERE id = @id`
      )
      .run(row);

    return updated;
  }

  /**
   * Delete a session
   */
  deleteSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get sessions with optional filters
   */
  getSessions(filter?: SessionFilter): Session[] {
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (filter?.projectPath) {
      sql += ' AND project_path = @projectPath';
      params.projectPath = filter.projectPath;
    }

    if (filter?.since) {
      sql += ' AND started_at >= @since';
      params.since = filter.since;
    }

    if (filter?.active === true) {
      sql += ' AND ended_at IS NULL';
    } else if (filter?.active === false) {
      sql += ' AND ended_at IS NOT NULL';
    }

    sql += ' ORDER BY started_at DESC';

    const rows = this.db.prepare(sql).all(params) as SessionRow[];
    return rows.map(rowToSession);
  }

  /**
   * Get active (ongoing) sessions
   */
  getActiveSessions(): Session[] {
    return this.getSessions({ active: true });
  }

  /**
   * End a session
   */
  endSession(id: string): Session | null {
    return this.updateSession(id, { endedAt: Date.now() });
  }

  /**
   * Increment message count for a session
   */
  incrementMessageCount(id: string, count: number = 1): Session | null {
    const session = this.getSession(id);
    if (!session) return null;

    return this.updateSession(id, {
      messageCount: session.messageCount + count,
    });
  }

  /**
   * Get or create session (upsert)
   */
  getOrCreateSession(id: string, projectPath: string): Session {
    const existing = this.getSession(id);
    if (existing) return existing;

    const session: Session = {
      id,
      projectPath,
      startedAt: Date.now(),
      messageCount: 0,
    };

    return this.createSession(session);
  }

  // ============================================
  // STATISTICS
  // ============================================

  /**
   * Get overall statistics
   */
  getStats(): {
    rules: { total: number; active: number; proposed: number; pruned: number };
    patterns: { total: number; byType: Record<string, number> };
    sessions: { total: number; active: number; totalMessages: number };
  } {
    const ruleStats = this.db
      .prepare(
        `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN state = 'proposed' THEN 1 ELSE 0 END) as proposed,
         SUM(CASE WHEN state = 'pruned' THEN 1 ELSE 0 END) as pruned
       FROM rules`
      )
      .get() as { total: number; active: number; proposed: number; pruned: number };

    const patternTotal = (
      this.db.prepare('SELECT COUNT(*) as count FROM patterns').get() as { count: number }
    ).count;

    const sessionStats = this.db
      .prepare(
        `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) as active,
         SUM(message_count) as totalMessages
       FROM sessions`
      )
      .get() as { total: number; active: number; totalMessages: number };

    return {
      rules: ruleStats,
      patterns: {
        total: patternTotal,
        byType: this.countPatternsByType(),
      },
      sessions: sessionStats,
    };
  }
}

// Singleton instance for convenience
let defaultInstance: LearnerDB | null = null;

/**
 * Get the default database instance
 */
export function getDB(dbPath?: string): LearnerDB {
  if (!defaultInstance || (dbPath && dbPath !== defaultInstance.getPath())) {
    defaultInstance?.close();
    defaultInstance = new LearnerDB(dbPath);
  }
  return defaultInstance;
}

/**
 * Close the default database instance
 */
export function closeDB(): void {
  defaultInstance?.close();
  defaultInstance = null;
}

// Re-export types and utilities
export * from './types.js';
