/**
 * MCP Tool Definitions for claude-learner v2
 * 
 * Tools exposed to Claude Code via MCP protocol
 * Uses SQLite storage for real data persistence
 */

import { z } from 'zod';
import { getDB } from '../storage/db.js';
import { getComplianceRate, createPatternId, createRuleId } from '../storage/types.js';
import { syncRules } from '../sync.js';
import type { Rule, Pattern } from '../storage/types.js';

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const GetRulesInputSchema = z.object({
  project: z.string().optional().describe('Filter by project path'),
  file: z.string().optional().describe('Filter by file path'),
  scope: z.enum(['global', 'project', 'file']).optional().describe('Filter by scope'),
});

export const CheckRuleInputSchema = z.object({
  action: z.string().describe('The action about to be taken (e.g., "delete file with rm")'),
  context: z.string().optional().describe('File/project context'),
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

export const RecordComplianceInputSchema = z.object({
  ruleId: z.string().describe('ID of the rule'),
  followed: z.boolean().describe('Whether the rule was followed'),
});

export const SyncToClaudeMdInputSchema = z.object({
  project: z.string().optional().describe('Project path for scoped rules'),
  global: z.boolean().optional().describe('Only sync global rules to ~/.claude/CLAUDE.md'),
  target: z.string().optional().describe('Custom target CLAUDE.md path'),
});

export const PruneRulesInputSchema = z.object({
  dryRun: z.boolean().optional().describe('Preview pruning candidates without changing anything (default: true)'),
  ruleIds: z.array(z.string()).optional().describe('Explicit rule IDs to prune; if omitted, low-compliance candidates are selected automatically'),
  minOpportunities: z.number().optional().describe('Minimum observations before a rule qualifies as a candidate (default: 10)'),
  maxComplianceRate: z.number().optional().describe('Compliance rate below which a rule qualifies (default: 0.3)'),
});

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get active rules for current context
 */
export async function handleGetRules(
  input: z.infer<typeof GetRulesInputSchema>
): Promise<{ rules: Array<Rule & { complianceRate: number }> }> {
  const db = getDB();
  
  let rules: Rule[];
  
  if (input.project || input.file) {
    rules = db.getActiveRulesForContext(input.project, input.file);
  } else if (input.scope) {
    rules = db.getRules({ state: 'active', scope: input.scope });
  } else {
    rules = db.getRules({ state: 'active' });
  }
  
  return {
    rules: rules.map(r => ({
      ...r,
      complianceRate: getComplianceRate(r),
    })),
  };
}

/**
 * Check if an action would violate any active rule
 */
export async function handleCheckRule(
  input: z.infer<typeof CheckRuleInputSchema>
): Promise<{ allowed: boolean; violatedRule?: Rule; suggestion?: string }> {
  const db = getDB();
  const rules = db.getRules({ state: 'active' });
  
  const actionLower = input.action.toLowerCase();
  
  for (const rule of rules) {
    // Check for negation patterns
    const isProhibition = /\b(don'?t|avoid|never|no|stop)\b/i.test(rule.text);
    
    if (isProhibition) {
      // Extract what's prohibited
      const prohibitedMatch = rule.text.match(/(?:don'?t|avoid|never|no|stop)\s+(.+)/i);
      if (prohibitedMatch) {
        const prohibited = prohibitedMatch[1].toLowerCase().trim();
        
        if (actionLower.includes(prohibited) || prohibited.includes(actionLower)) {
          return {
            allowed: false,
            violatedRule: rule,
            suggestion: `This action may violate a rule: "${rule.text}". Consider an alternative approach.`,
          };
        }
      }
    }
    
    // Check for "use X instead of Y" patterns
    const insteadMatch = rule.text.match(/use\s+(\w+)\s+instead\s+of\s+(\w+)/i);
    if (insteadMatch) {
      const avoid = insteadMatch[2].toLowerCase();
      const prefer = insteadMatch[1].toLowerCase();
      
      if (actionLower.includes(avoid) && !actionLower.includes(prefer)) {
        return {
          allowed: false,
          violatedRule: rule,
          suggestion: `Consider using ${prefer} instead. Rule: "${rule.text}"`,
        };
      }
    }
  }
  
  return { allowed: true };
}

/**
 * Log a user correction to propose a new rule
 */
export async function handleLogCorrection(
  input: z.infer<typeof LogCorrectionInputSchema>
): Promise<{ patternId: string; proposedRule?: { id: string; text: string } }> {
  const db = getDB();
  
  // Create pattern
  const pattern: Pattern = {
    id: createPatternId(),
    sessionId: 'mcp-session', // MCP doesn't have session context
    type: 'correction',
    content: input.userMessage,
    context: input.assistantContext,
    projectPath: input.project,
    filePath: input.file,
    detectedAt: Date.now(),
  };
  
  db.createPattern(pattern);
  
  // Check if we should propose a rule
  // Look for similar corrections
  const recentPatterns = db.getPatterns({ type: 'correction' })
    .filter(p => p.projectPath === input.project)
    .slice(0, 10);
  
  // Simple rule extraction from correction
  let ruleText: string | null = null;
  
  // Try to extract actionable instruction
  const msg = input.userMessage;
  
  // "don't X" → "Don't X"
  const dontMatch = msg.match(/don'?t\s+(.+?)(?:\.|,|!|$)/i);
  if (dontMatch) {
    ruleText = `Don't ${dontMatch[1]}`;
  }
  
  // "use X instead" → "Use X"
  const useMatch = msg.match(/use\s+(.+?)\s+instead/i);
  if (useMatch) {
    ruleText = `Use ${useMatch[1]}`;
  }
  
  // "always X" → "Always X"
  const alwaysMatch = msg.match(/always\s+(.+?)(?:\.|,|!|$)/i);
  if (alwaysMatch) {
    ruleText = `Always ${alwaysMatch[1]}`;
  }
  
  // "never X" → "Never X"
  const neverMatch = msg.match(/never\s+(.+?)(?:\.|,|!|$)/i);
  if (neverMatch) {
    ruleText = `Never ${neverMatch[1]}`;
  }
  
  if (ruleText) {
    // Check if similar rule exists
    const existing = db.getRules({ states: ['active', 'proposed'] as any })
      .find(r => r.text.toLowerCase().includes(ruleText!.toLowerCase().slice(0, 20)));
    
    if (!existing) {
      const rule: Rule = {
        id: createRuleId(),
        text: ruleText,
        scope: input.file ? 'file' : 'project',
        scopeTarget: input.file || input.project,
        state: 'proposed',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        sourcePatterns: [pattern.id],
        opportunities: 0,
        followed: 0,
        violated: 0,
      };
      
      db.createRule(rule);
      
      return {
        patternId: pattern.id,
        proposedRule: { id: rule.id, text: rule.text },
      };
    }
  }
  
  return { patternId: pattern.id };
}

/**
 * Get rules awaiting approval
 */
export async function handleGetPendingRules(
  _input: z.infer<typeof GetPendingRulesInputSchema>
): Promise<{ rules: Array<Rule & { complianceRate: number }> }> {
  const db = getDB();
  const rules = db.getProposedRules();
  
  return {
    rules: rules.map(r => ({
      ...r,
      complianceRate: getComplianceRate(r),
    })),
  };
}

/**
 * Approve a proposed rule (make it active)
 */
export async function handleApproveRule(
  input: z.infer<typeof ApproveRuleInputSchema>
): Promise<{ success: boolean; rule?: Rule; error?: string }> {
  const db = getDB();
  const rule = db.approveRule(input.ruleId);
  
  if (!rule) {
    return {
      success: false,
      error: `Rule ${input.ruleId} not found or not in proposed state`,
    };
  }
  
  return { success: true, rule };
}

/**
 * Reject a proposed rule
 */
export async function handleRejectRule(
  input: z.infer<typeof RejectRuleInputSchema>
): Promise<{ success: boolean; error?: string }> {
  const db = getDB();
  const rule = db.rejectRule(input.ruleId);
  
  if (!rule) {
    return {
      success: false,
      error: `Rule ${input.ruleId} not found or not in proposed state`,
    };
  }
  
  return { success: true };
}

/**
 * Record whether a rule was followed (for effectiveness tracking)
 */
export async function handleRecordCompliance(
  input: z.infer<typeof RecordComplianceInputSchema>
): Promise<{ success: boolean; rule?: Rule & { complianceRate: number } }> {
  const db = getDB();
  
  let rule: Rule | null;
  if (input.followed) {
    rule = db.recordRuleFollowed(input.ruleId);
  } else {
    rule = db.recordRuleViolated(input.ruleId);
  }
  
  if (!rule) {
    return { success: false };
  }
  
  return {
    success: true,
    rule: {
      ...rule,
      complianceRate: getComplianceRate(rule),
    },
  };
}

/**
 * Sync active rules into a CLAUDE.md file
 */
export async function handleSyncToClaudeMd(
  input: z.infer<typeof SyncToClaudeMdInputSchema>
): Promise<{ success: boolean; path: string; rulesWritten: number; created: boolean }> {
  const result = syncRules({
    project: input.project,
    global: input.global,
    target: input.target,
  });

  return {
    success: true,
    path: result.path,
    rulesWritten: result.rulesWritten,
    created: result.created,
  };
}

/**
 * Prune low-value rules. Dry-run by default — pass dryRun: false to apply.
 */
export async function handlePruneRules(
  input: z.infer<typeof PruneRulesInputSchema>
): Promise<{
  dryRun: boolean;
  candidates: Array<{ id: string; text: string; complianceRate: number; opportunities: number }>;
  pruned: string[];
}> {
  const db = getDB();
  const dryRun = input.dryRun ?? true;

  let targets: Rule[];
  if (input.ruleIds && input.ruleIds.length > 0) {
    targets = input.ruleIds
      .map((id) => db.getRule(id))
      .filter((r): r is Rule => r !== null && r.state === 'active');
  } else {
    targets = db.getRulesForPruning(
      input.minOpportunities ?? 10,
      input.maxComplianceRate ?? 0.3
    );
  }

  const candidates = targets.map((r) => ({
    id: r.id,
    text: r.text,
    complianceRate: getComplianceRate(r),
    opportunities: r.opportunities,
  }));

  const pruned: string[] = [];
  if (!dryRun) {
    for (const r of targets) {
      const result = db.pruneRule(r.id);
      if (result) pruned.push(r.id);
    }
  }

  return { dryRun, candidates, pruned };
}
