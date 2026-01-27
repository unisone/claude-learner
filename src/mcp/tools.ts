/**
 * MCP Tool Definitions for claude-learner v2
 * 
 * Tools exposed to Claude Code via MCP protocol
 */

import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

export type RuleScope = 'global' | 'project' | 'file';
export type RuleState = 'proposed' | 'active' | 'rejected' | 'pruned';

export interface Rule {
  id: string;
  text: string;
  scope: RuleScope;
  scopeTarget?: string;
  state: RuleState;
  createdAt: number;
  lastSeenAt: number;
  sourcePatterns: string[];
  opportunities: number;
  followed: number;
  violated: number;
  complianceRate: number;
}

export interface Pattern {
  id: string;
  sessionId: string;
  type: string;
  content: string;
  context: string;
  detectedAt: number;
}

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const GetRulesInputSchema = z.object({
  project: z.string().optional().describe('Filter by project path'),
  file: z.string().optional().describe('Filter by file path'),
  scope: z.enum(['global', 'project', 'file']).optional().describe('Filter by scope'),
});

export const CheckRuleInputSchema = z.object({
  action: z.string().describe('The action about to be taken (e.g., "Using any type")'),
  context: z.string().describe('File/project context'),
});

export const LogCorrectionInputSchema = z.object({
  userMessage: z.string().describe('The user correction message'),
  assistantContext: z.string().describe('What Claude was doing when corrected'),
  project: z.string().describe('Project path'),
  file: z.string().optional().describe('File path if applicable'),
});

export const GetPendingRulesInputSchema = z.object({});

export const ApproveRuleInputSchema = z.object({
  ruleId: z.string().describe('ID of the rule to approve'),
});

export const RejectRuleInputSchema = z.object({
  ruleId: z.string().describe('ID of the rule to reject'),
});

// ============================================================================
// Mock Data Store (replace with SQLite later)
// ============================================================================

class MockStore {
  private rules: Map<string, Rule> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private patternCounter = 0;

  constructor() {
    // Seed with some example rules
    this.addRule({
      id: 'rule-001',
      text: 'Avoid using "any" type in TypeScript - use "unknown" or define proper types',
      scope: 'global',
      state: 'active',
      createdAt: Date.now() - 86400000 * 7,
      lastSeenAt: Date.now() - 3600000,
      sourcePatterns: ['pattern-001', 'pattern-002'],
      opportunities: 25,
      followed: 22,
      violated: 3,
      complianceRate: 0.88,
    });

    this.addRule({
      id: 'rule-002',
      text: 'Run tests before committing code changes',
      scope: 'global',
      state: 'active',
      createdAt: Date.now() - 86400000 * 5,
      lastSeenAt: Date.now() - 7200000,
      sourcePatterns: ['pattern-003'],
      opportunities: 15,
      followed: 14,
      violated: 1,
      complianceRate: 0.93,
    });

    this.addRule({
      id: 'rule-003',
      text: 'Use 2-space indentation for TypeScript/JavaScript files',
      scope: 'project',
      scopeTarget: '/Users/dev/my-project',
      state: 'proposed',
      createdAt: Date.now() - 3600000,
      lastSeenAt: Date.now() - 3600000,
      sourcePatterns: ['pattern-004'],
      opportunities: 0,
      followed: 0,
      violated: 0,
      complianceRate: 0,
    });

    this.addRule({
      id: 'rule-004',
      text: 'Prefer const over let when variable is not reassigned',
      scope: 'global',
      state: 'proposed',
      createdAt: Date.now() - 1800000,
      lastSeenAt: Date.now() - 1800000,
      sourcePatterns: ['pattern-005'],
      opportunities: 0,
      followed: 0,
      violated: 0,
      complianceRate: 0,
    });
  }

  private addRule(rule: Rule): void {
    this.rules.set(rule.id, rule);
  }

  getRules(filters: { project?: string; file?: string; scope?: RuleScope }): Rule[] {
    const results: Rule[] = [];
    
    for (const rule of this.rules.values()) {
      // Only return active rules by default
      if (rule.state !== 'active') continue;
      
      // Filter by scope
      if (filters.scope && rule.scope !== filters.scope) continue;
      
      // Filter by project
      if (filters.project && rule.scope === 'project') {
        if (rule.scopeTarget && !filters.project.includes(rule.scopeTarget)) continue;
      }
      
      // Filter by file
      if (filters.file && rule.scope === 'file') {
        if (rule.scopeTarget && !filters.file.match(rule.scopeTarget)) continue;
      }
      
      results.push(rule);
    }
    
    return results;
  }

  checkRule(action: string, context: string): { allowed: boolean; rule?: Rule; suggestion?: string } {
    const actionLower = action.toLowerCase();
    
    for (const rule of this.rules.values()) {
      if (rule.state !== 'active') continue;
      
      // Simple pattern matching (would be more sophisticated in production)
      if (actionLower.includes('any') && rule.text.toLowerCase().includes('any')) {
        return {
          allowed: false,
          rule,
          suggestion: 'Use "unknown" type or define a specific interface/type',
        };
      }
      
      if (actionLower.includes('let') && rule.text.toLowerCase().includes('const over let')) {
        return {
          allowed: false,
          rule,
          suggestion: 'Use const if the variable will not be reassigned',
        };
      }
    }
    
    return { allowed: true };
  }

  logCorrection(input: {
    userMessage: string;
    assistantContext: string;
    project: string;
    file?: string;
  }): { patternId: string; proposedRule?: Rule } {
    // Create a pattern
    const patternId = `pattern-${++this.patternCounter}`;
    const pattern: Pattern = {
      id: patternId,
      sessionId: `session-${Date.now()}`,
      type: 'correction',
      content: input.userMessage,
      context: input.assistantContext,
      detectedAt: Date.now(),
    };
    this.patterns.set(patternId, pattern);
    
    // Check if we should propose a rule based on the correction
    const userMsgLower = input.userMessage.toLowerCase();
    let proposedRule: Rule | undefined;
    
    // Simple heuristics for rule proposal
    if (userMsgLower.includes('no') || userMsgLower.includes('wrong') || userMsgLower.includes("don't")) {
      const ruleId = `rule-${Date.now()}`;
      proposedRule = {
        id: ruleId,
        text: `User correction: ${input.userMessage.slice(0, 100)}`,
        scope: input.file ? 'file' : 'project',
        scopeTarget: input.file || input.project,
        state: 'proposed',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        sourcePatterns: [patternId],
        opportunities: 0,
        followed: 0,
        violated: 0,
        complianceRate: 0,
      };
      this.rules.set(ruleId, proposedRule);
    }
    
    return { patternId, proposedRule };
  }

  getPendingRules(): Rule[] {
    const results: Rule[] = [];
    for (const rule of this.rules.values()) {
      if (rule.state === 'proposed') {
        results.push(rule);
      }
    }
    return results;
  }

  approveRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    if (rule.state !== 'proposed') return false;
    
    rule.state = 'active';
    rule.lastSeenAt = Date.now();
    return true;
  }

  rejectRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    if (rule.state !== 'proposed') return false;
    
    rule.state = 'rejected';
    rule.lastSeenAt = Date.now();
    return true;
  }
}

// Singleton store instance
export const store = new MockStore();

// ============================================================================
// Tool Handlers
// ============================================================================

export function handleGetRules(input: z.infer<typeof GetRulesInputSchema>) {
  const rules = store.getRules({
    project: input.project,
    file: input.file,
    scope: input.scope,
  });
  return { rules };
}

export function handleCheckRule(input: z.infer<typeof CheckRuleInputSchema>) {
  return store.checkRule(input.action, input.context);
}

export function handleLogCorrection(input: z.infer<typeof LogCorrectionInputSchema>) {
  return store.logCorrection(input);
}

export function handleGetPendingRules(_input: z.infer<typeof GetPendingRulesInputSchema>) {
  const rules = store.getPendingRules();
  return { rules };
}

export function handleApproveRule(input: z.infer<typeof ApproveRuleInputSchema>) {
  const success = store.approveRule(input.ruleId);
  return { success };
}

export function handleRejectRule(input: z.infer<typeof RejectRuleInputSchema>) {
  const success = store.rejectRule(input.ruleId);
  return { success };
}
