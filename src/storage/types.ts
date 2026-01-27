/**
 * Storage layer types for claude-learner v2
 */

// Rule scope types
export type RuleScope = 'global' | 'project' | 'file';

// Rule state machine states
export type RuleState = 'proposed' | 'active' | 'rejected' | 'pruned';

// Pattern types detected by analyzer
export type PatternType =
  | 'correction'
  | 'rollback'
  | 'retry'
  | 'failed_command'
  | 'repeated_ask';

// ID generators
export function createPatternId(): string {
  return `pat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function createRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Rule - A learned behavior guideline
 */
export interface Rule {
  id: string;
  text: string; // "Use 2-space indentation"
  scope: RuleScope;
  scopeTarget?: string; // Project path or file pattern
  state: RuleState;

  // Tracking
  createdAt: number; // Unix timestamp (ms)
  lastSeenAt: number;
  sourcePatterns: string[]; // Pattern IDs that created this

  // Effectiveness metrics
  opportunities: number; // Times rule was relevant
  followed: number; // Times Claude followed it
  violated: number; // Times Claude broke it
}

/**
 * Calculated compliance rate for a rule
 */
export function getComplianceRate(rule: Rule): number {
  if (rule.opportunities === 0) return 1.0;
  return rule.followed / rule.opportunities;
}

/**
 * Pattern - A raw detection from session analysis
 */
export interface Pattern {
  id: string;
  sessionId: string;
  type: PatternType;
  content: string; // The actual correction/pattern text
  context: string; // Previous assistant message or context
  projectPath?: string;
  filePath?: string;
  detectedAt: number; // Unix timestamp (ms)
}

/**
 * Session - Metadata about a Claude Code session
 */
export interface Session {
  id: string;
  projectPath: string;
  startedAt: number; // Unix timestamp (ms)
  endedAt?: number; // Null if ongoing
  messageCount: number;
}

// Database row types (snake_case for SQLite)
export interface RuleRow {
  id: string;
  text: string;
  scope: string;
  scope_target: string | null;
  state: string;
  created_at: number;
  last_seen_at: number;
  source_patterns: string; // JSON array
  opportunities: number;
  followed: number;
  violated: number;
}

export interface PatternRow {
  id: string;
  session_id: string;
  type: string;
  content: string;
  context: string;
  detected_at: number;
}

export interface SessionRow {
  id: string;
  project_path: string;
  started_at: number;
  ended_at: number | null;
  message_count: number;
}

// Conversion helpers
export function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    text: row.text,
    scope: row.scope as RuleScope,
    scopeTarget: row.scope_target ?? undefined,
    state: row.state as RuleState,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    sourcePatterns: JSON.parse(row.source_patterns),
    opportunities: row.opportunities,
    followed: row.followed,
    violated: row.violated,
  };
}

export function ruleToRow(rule: Rule): RuleRow {
  return {
    id: rule.id,
    text: rule.text,
    scope: rule.scope,
    scope_target: rule.scopeTarget ?? null,
    state: rule.state,
    created_at: rule.createdAt,
    last_seen_at: rule.lastSeenAt,
    source_patterns: JSON.stringify(rule.sourcePatterns),
    opportunities: rule.opportunities,
    followed: rule.followed,
    violated: rule.violated,
  };
}

export function rowToPattern(row: PatternRow): Pattern {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type as PatternType,
    content: row.content,
    context: row.context,
    detectedAt: row.detected_at,
  };
}

export function patternToRow(pattern: Pattern): PatternRow {
  return {
    id: pattern.id,
    session_id: pattern.sessionId,
    type: pattern.type,
    content: pattern.content,
    context: pattern.context,
    detected_at: pattern.detectedAt,
  };
}

export function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectPath: row.project_path,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    messageCount: row.message_count,
  };
}

export function sessionToRow(session: Session): SessionRow {
  return {
    id: session.id,
    project_path: session.projectPath,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? null,
    message_count: session.messageCount,
  };
}

// Query filter types
export interface RuleFilter {
  scope?: RuleScope;
  scopeTarget?: string;
  state?: RuleState;
  states?: RuleState[];
}

export interface PatternFilter {
  sessionId?: string;
  type?: PatternType;
  since?: number; // Unix timestamp
}

export interface SessionFilter {
  projectPath?: string;
  since?: number; // Unix timestamp
  active?: boolean; // endedAt is null
}
