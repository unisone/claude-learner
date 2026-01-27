/**
 * Canonical Types for claude-learner v2
 * 
 * ALL modules should import from here.
 * DO NOT create duplicate interfaces elsewhere.
 */

// ============================================================================
// Enums
// ============================================================================

export type RuleState = 'proposed' | 'active' | 'rejected' | 'pruned';
export type RuleScope = 'global' | 'project' | 'file';
export type PatternType = 'correction' | 'rollback' | 'retry' | 'failed_command' | 'repeated_ask';

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Rule - A learned behavior guideline
 */
export interface Rule {
  id: string;
  text: string;
  scope: RuleScope;
  scopeTarget?: string;  // Project path or file pattern
  state: RuleState;
  
  // Timestamps
  createdAt: number;     // Unix timestamp (ms)
  lastSeenAt: number;
  
  // Source tracking
  sourcePatterns: string[];  // Pattern IDs that created this rule
  
  // Effectiveness tracking
  opportunities: number;     // Times rule was relevant
  followed: number;          // Times Claude followed it
  violated: number;          // Times Claude broke it
}

/**
 * Pattern - A raw detection from session analysis
 */
export interface Pattern {
  id: string;
  sessionId: string;
  type: PatternType;
  content: string;       // The correction/pattern text
  context: string;       // Previous assistant context
  projectPath?: string;
  filePath?: string;
  detectedAt: number;    // Unix timestamp (ms)
}

/**
 * Session - Metadata about a Claude Code session
 */
export interface Session {
  id: string;
  projectPath: string;
  startedAt: number;     // Unix timestamp (ms)
  endedAt?: number;
  messageCount: number;
}

// ============================================================================
// Computed Properties
// ============================================================================

export function getComplianceRate(rule: Rule): number {
  if (rule.opportunities === 0) return 1;
  return rule.followed / rule.opportunities;
}

export function shouldAutoPrune(rule: Rule): boolean {
  return rule.opportunities >= 10 && getComplianceRate(rule) < 0.3;
}

export function getRulePriority(rule: Rule): 'high' | 'medium' | 'low' {
  const rate = getComplianceRate(rule);
  if (rate >= 0.8) return 'high';
  if (rate >= 0.5) return 'medium';
  return 'low';
}

// ============================================================================
// ID Generators
// ============================================================================

export function createRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function createPatternId(): string {
  return `pat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Database Row Types (snake_case for SQLite)
// ============================================================================

export interface RuleRow {
  id: string;
  text: string;
  scope: string;
  scope_target: string | null;
  state: string;
  created_at: number;
  last_seen_at: number;
  source_patterns: string;  // JSON array
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
  project_path: string | null;
  file_path: string | null;
  detected_at: number;
}

export interface SessionRow {
  id: string;
  project_path: string;
  started_at: number;
  ended_at: number | null;
  message_count: number;
}

// ============================================================================
// Row Converters
// ============================================================================

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
    projectPath: row.project_path ?? undefined,
    filePath: row.file_path ?? undefined,
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
    project_path: pattern.projectPath ?? null,
    file_path: pattern.filePath ?? null,
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

// ============================================================================
// Filter Types
// ============================================================================

export interface RuleFilter {
  scope?: RuleScope;
  scopeTarget?: string;
  state?: RuleState;
  states?: RuleState[];
}

export interface PatternFilter {
  sessionId?: string;
  type?: PatternType;
  since?: number;
}

export interface SessionFilter {
  projectPath?: string;
  since?: number;
  active?: boolean;
}
