// Rule Proposer - Converts patterns into rule suggestions

import { Pattern, Rule, RuleScope, createRuleId } from './types.js';

export interface ProposedRule {
  text: string;
  scope: RuleScope;
  scopeTarget?: string;
  confidence: number;  // 0-1
  sourcePatterns: Pattern[];
  reason: string;
}

// Pattern templates for rule generation
const CORRECTION_TEMPLATES = [
  { pattern: /\buse\s+(\w+)\s+instead\b/i, template: 'Use $1' },
  { pattern: /\bdon'?t\s+use\s+(\w+)\b/i, template: "Don't use $1" },
  { pattern: /\balways\s+(\w+)/i, template: 'Always $1' },
  { pattern: /\bnever\s+(\w+)/i, template: 'Never $1' },
  { pattern: /\bprefer\s+(\w+)\s+over\s+(\w+)/i, template: 'Prefer $1 over $2' },
  { pattern: /\brun\s+(\w+)\s+before\s+(\w+)/i, template: 'Run $1 before $2' },
];

// Keywords that indicate a correction
const CORRECTION_INDICATORS = [
  'no,', 'wrong', 'incorrect', "don't", 'stop', 'undo', 
  'revert', 'actually', 'instead', 'should be', 'not'
];

export class RuleProposer {
  // Analyze patterns and propose rules
  proposeRules(patterns: Pattern[]): ProposedRule[] {
    const proposals: ProposedRule[] = [];
    
    // Group patterns by similarity
    const groups = this.groupSimilarPatterns(patterns);
    
    for (const group of groups) {
      const proposal = this.analyzePatternGroup(group);
      if (proposal) {
        proposals.push(proposal);
      }
    }
    
    return proposals;
  }
  
  // Group similar patterns together
  private groupSimilarPatterns(patterns: Pattern[]): Pattern[][] {
    const groups: Pattern[][] = [];
    const used = new Set<string>();
    
    for (const pattern of patterns) {
      if (used.has(pattern.id)) continue;
      
      const group: Pattern[] = [pattern];
      used.add(pattern.id);
      
      // Find similar patterns
      for (const other of patterns) {
        if (used.has(other.id)) continue;
        
        if (this.areSimilar(pattern, other)) {
          group.push(other);
          used.add(other.id);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }
  
  // Check if two patterns are similar
  private areSimilar(a: Pattern, b: Pattern): boolean {
    // Same type
    if (a.type !== b.type) return false;
    
    // Normalize and compare content
    const aNorm = this.normalizeContent(a.content);
    const bNorm = this.normalizeContent(b.content);
    
    // Check for significant word overlap
    const aWords = new Set(aNorm.split(/\s+/));
    const bWords = new Set(bNorm.split(/\s+/));
    
    let overlap = 0;
    for (const word of aWords) {
      if (bWords.has(word)) overlap++;
    }
    
    const similarity = overlap / Math.max(aWords.size, bWords.size);
    return similarity > 0.5;
  }
  
  // Normalize content for comparison
  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // Analyze a group of patterns and propose a rule
  private analyzePatternGroup(patterns: Pattern[]): ProposedRule | null {
    if (patterns.length === 0) return null;
    
    // Need at least 2 occurrences to propose
    if (patterns.length < 2) return null;
    
    const primary = patterns[0];
    
    // Try to extract a rule from the content
    const ruleText = this.extractRuleText(primary.content);
    if (!ruleText) return null;
    
    // Determine scope
    const scope = this.determineScope(patterns);
    const scopeTarget = this.determineScopeTarget(patterns);
    
    // Calculate confidence based on pattern count and consistency
    const confidence = Math.min(0.9, 0.3 + (patterns.length * 0.15));
    
    return {
      text: ruleText,
      scope,
      scopeTarget,
      confidence,
      sourcePatterns: patterns,
      reason: `Detected ${patterns.length} times`,
    };
  }
  
  // Extract actionable rule text from pattern content
  private extractRuleText(content: string): string | null {
    // Try template matching first
    for (const { pattern, template } of CORRECTION_TEMPLATES) {
      const match = content.match(pattern);
      if (match) {
        return template.replace(/\$(\d+)/g, (_, i) => match[parseInt(i)] || '');
      }
    }
    
    // Check for correction indicators
    const hasIndicator = CORRECTION_INDICATORS.some(ind => 
      content.toLowerCase().includes(ind)
    );
    
    if (!hasIndicator) return null;
    
    // Extract the core instruction
    // Remove filler words and keep the actionable part
    let cleaned = content
      .replace(/^(no,?\s*|actually,?\s*|wait,?\s*)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    
    // Limit length
    if (cleaned.length > 100) {
      cleaned = cleaned.slice(0, 97) + '...';
    }
    
    return cleaned;
  }
  
  // Determine the scope of a rule based on patterns
  private determineScope(patterns: Pattern[]): RuleScope {
    // Check if all patterns are from the same file
    const files = new Set(patterns.map(p => p.filePath).filter(Boolean));
    if (files.size === 1) return 'file';
    
    // Check if all patterns are from the same project
    const projects = new Set(patterns.map(p => p.projectPath).filter(Boolean));
    if (projects.size === 1) return 'project';
    
    return 'global';
  }
  
  // Determine the scope target (file or project path)
  private determineScopeTarget(patterns: Pattern[]): string | undefined {
    const scope = this.determineScope(patterns);
    
    if (scope === 'file') {
      return patterns[0].filePath;
    }
    
    if (scope === 'project') {
      return patterns[0].projectPath;
    }
    
    return undefined;
  }
  
  // Convert a proposed rule to an actual rule
  createRuleFromProposal(proposal: ProposedRule): Rule {
    return {
      id: createRuleId(),
      text: proposal.text,
      scope: proposal.scope,
      scopeTarget: proposal.scopeTarget,
      state: 'proposed',
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      sourcePatterns: proposal.sourcePatterns.map(p => p.id),
      opportunities: 0,
      followed: 0,
      violated: 0,
    };
  }
}

export const ruleProposer = new RuleProposer();
