// Rule Engine - State machine for rule lifecycle
// Propose → Approve → Active → (Prune if ineffective)

import { Rule, Pattern, RuleState, RuleScope, createRuleId, getComplianceRate, shouldAutoPrune } from './types.js';

export interface RuleEngineConfig {
  autoPruneEnabled: boolean;
  minOpportunitiesForPrune: number;
  pruneThreshold: number;  // Compliance rate below which to prune
}

const DEFAULT_CONFIG: RuleEngineConfig = {
  autoPruneEnabled: true,
  minOpportunitiesForPrune: 10,
  pruneThreshold: 0.3,
};

export class RuleEngine {
  private rules: Map<string, Rule> = new Map();
  private config: RuleEngineConfig;
  
  constructor(config: Partial<RuleEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // Load rules from storage
  loadRules(rules: Rule[]): void {
    this.rules.clear();
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
  }
  
  // Get all rules
  getAllRules(): Rule[] {
    return Array.from(this.rules.values());
  }
  
  // Get rules by state
  getRulesByState(state: RuleState): Rule[] {
    return this.getAllRules().filter(r => r.state === state);
  }
  
  // Get active rules for a context
  getActiveRules(context?: { project?: string; file?: string }): Rule[] {
    return this.getAllRules()
      .filter(r => r.state === 'active')
      .filter(r => {
        // Global rules always apply
        if (r.scope === 'global') return true;
        
        // Project rules apply if project matches
        if (r.scope === 'project' && context?.project) {
          return r.scopeTarget === context.project || 
                 context.project.includes(r.scopeTarget || '');
        }
        
        // File rules apply if file matches
        if (r.scope === 'file' && context?.file) {
          try {
            return context.file.includes(r.scopeTarget || '') ||
                   (r.scopeTarget && new RegExp(r.scopeTarget).test(context.file));
          } catch {
            // Invalid regex in scopeTarget — fall back to includes
            return context.file.includes(r.scopeTarget || '');
          }
        }
        
        return false;
      });
  }
  
  // Propose a new rule from a pattern
  proposeRule(
    text: string,
    scope: RuleScope,
    sourcePattern: Pattern,
    scopeTarget?: string
  ): Rule {
    const rule: Rule = {
      id: createRuleId(),
      text,
      scope,
      scopeTarget,
      state: 'proposed',
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      sourcePatterns: [sourcePattern.id],
      opportunities: 0,
      followed: 0,
      violated: 0,
    };
    
    this.rules.set(rule.id, rule);
    return rule;
  }
  
  // Approve a proposed rule
  approveRule(ruleId: string): Rule | null {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.state !== 'proposed') return null;
    
    rule.state = 'active';
    rule.lastSeenAt = Date.now();
    return rule;
  }
  
  // Reject a proposed rule
  rejectRule(ruleId: string): Rule | null {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.state !== 'proposed') return null;
    
    rule.state = 'rejected';
    return rule;
  }
  
  // Prune an ineffective rule
  pruneRule(ruleId: string): Rule | null {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.state !== 'active') return null;
    
    rule.state = 'pruned';
    return rule;
  }
  
  // Record that a rule was followed
  recordFollowed(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.state !== 'active') return;
    
    rule.opportunities++;
    rule.followed++;
    rule.lastSeenAt = Date.now();
    
    this.checkAutoPrune(rule);
  }
  
  // Record that a rule was violated
  recordViolated(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (!rule || rule.state !== 'active') return;
    
    rule.opportunities++;
    rule.violated++;
    rule.lastSeenAt = Date.now();
    
    this.checkAutoPrune(rule);
  }
  
  // Check if rule should be auto-pruned
  private checkAutoPrune(rule: Rule): void {
    if (!this.config.autoPruneEnabled) return;
    if (rule.opportunities < this.config.minOpportunitiesForPrune) return;
    
    const compliance = getComplianceRate(rule);
    if (compliance < this.config.pruneThreshold) {
      rule.state = 'pruned';
    }
  }
  
  // Check if an action would violate any active rule
  checkAction(action: string, context?: { project?: string; file?: string }): {
    allowed: boolean;
    violatedRule?: Rule;
    suggestion?: string;
  } {
    const activeRules = this.getActiveRules(context);
    
    for (const rule of activeRules) {
      // Simple keyword matching for now
      // TODO: More sophisticated matching with embeddings
      const ruleKeywords = rule.text.toLowerCase().split(/\s+/);
      const actionLower = action.toLowerCase();
      
      // Check for negation patterns ("don't", "avoid", "never")
      const isProhibition = /\b(don'?t|avoid|never|no|stop)\b/i.test(rule.text);
      
      if (isProhibition) {
        // Extract what's prohibited
        const prohibited = rule.text
          .replace(/\b(don'?t|avoid|never|no|stop)\b/gi, '')
          .trim()
          .toLowerCase();
        
        if (actionLower.includes(prohibited) || prohibited.includes(actionLower)) {
          return {
            allowed: false,
            violatedRule: rule,
            suggestion: `Consider an alternative. Rule says: "${rule.text}"`
          };
        }
      }
    }
    
    return { allowed: true };
  }
  
  // Get rules that need attention (proposed or low compliance)
  getRulesNeedingAttention(): {
    proposed: Rule[];
    lowCompliance: Rule[];
  } {
    const all = this.getAllRules();
    
    return {
      proposed: all.filter(r => r.state === 'proposed'),
      lowCompliance: all.filter(r => 
        r.state === 'active' && 
        r.opportunities >= 5 && 
        getComplianceRate(r) < 0.5
      ),
    };
  }
  
  // Get effectiveness report
  getEffectivenessReport(): {
    high: Rule[];
    medium: Rule[];
    low: Rule[];
    ignored: Rule[];
  } {
    const active = this.getRulesByState('active');
    
    return {
      high: active.filter(r => getComplianceRate(r) >= 0.8),
      medium: active.filter(r => {
        const rate = getComplianceRate(r);
        return rate >= 0.5 && rate < 0.8;
      }),
      low: active.filter(r => {
        const rate = getComplianceRate(r);
        return rate >= 0.3 && rate < 0.5;
      }),
      ignored: active.filter(r => getComplianceRate(r) < 0.3),
    };
  }
}

export const ruleEngine = new RuleEngine();
