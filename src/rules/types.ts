// Rule Types for claude-learner v2

export type RuleState = 'proposed' | 'active' | 'rejected' | 'pruned';
export type RuleScope = 'global' | 'project' | 'file';

export interface Rule {
  id: string;
  text: string;
  scope: RuleScope;
  scopeTarget?: string;  // Project path or file pattern
  state: RuleState;
  
  // Timestamps
  createdAt: number;     // Unix timestamp
  lastSeenAt: number;
  approvedAt?: number;
  
  // Source tracking
  sourcePatterns: string[];  // Pattern IDs that created this rule
  
  // Effectiveness tracking
  opportunities: number;     // Times rule was relevant
  followed: number;          // Times Claude followed it
  violated: number;          // Times Claude broke it
}

export interface Pattern {
  id: string;
  sessionId: string;
  type: 'correction' | 'rollback' | 'retry' | 'failed_command' | 'repeated_ask';
  content: string;
  context: string;
  projectPath?: string;
  filePath?: string;
  detectedAt: number;
  convertedToRule?: string;  // Rule ID if converted
}

export interface Session {
  id: string;
  projectPath: string;
  startedAt: number;
  endedAt?: number;
  messageCount: number;
  lastAnalyzedAt?: number;
}

// Computed properties
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

// Rule creation helpers
export function createRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function createPatternId(): string {
  return `pat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
