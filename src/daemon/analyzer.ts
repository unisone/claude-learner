/**
 * Real-time Session Analyzer
 * Analyzes sessions as they're updated and proposes rules
 */

import * as fs from 'fs';
import { getDB } from '../storage/db.js';
import { Pattern, createPatternId, createRuleId } from '../storage/types.js';
// We'll use our own simple proposer logic to avoid type conflicts

// Correction indicators
const CORRECTION_PATTERNS = [
  /^no[,.]?\s/i,
  /^wrong/i,
  /^incorrect/i,
  /^actually[,.]?\s/i,
  /^stop/i,
  /^don'?t\s/i,
  /^undo/i,
  /^revert/i,
  /^cancel/i,
  /instead\s+of\s+/i,
  /should\s+be\s+/i,
  /not\s+like\s+that/i,
  /that'?s\s+wrong/i,
];

// Retry indicators
const RETRY_PATTERNS = [
  /try\s+again/i,
  /one\s+more\s+time/i,
  /let'?s\s+retry/i,
  /do\s+it\s+again/i,
];

// Failed command patterns
const FAILED_COMMAND_PATTERNS = [
  /command\s+not\s+found/i,
  /error:/i,
  /failed:/i,
  /permission\s+denied/i,
  /no\s+such\s+file/i,
];

interface SessionMessage {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

export class SessionAnalyzer {
  private db = getDB();
  private analyzedMessages = new Map<string, number>(); // sessionId -> last analyzed index

  /**
   * Analyze a session file and detect patterns
   */
  async analyzeSession(sessionPath: string, sessionId: string, projectPath: string): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    try {
      const content = fs.readFileSync(sessionPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Get or create session in DB
      const session = this.db.getOrCreateSession(sessionId, projectPath);

      // Track where we left off
      const lastIndex = this.analyzedMessages.get(sessionId) || 0;
      const newMessages: SessionMessage[] = [];

      for (let i = lastIndex; i < lines.length; i++) {
        try {
          const msg = JSON.parse(lines[i]) as SessionMessage;
          newMessages.push(msg);
        } catch {
          // Skip malformed lines
        }
      }

      // Update tracking
      this.analyzedMessages.set(sessionId, lines.length);
      this.db.updateSession(sessionId, { messageCount: lines.length });

      // Analyze new messages for patterns
      for (let i = 0; i < newMessages.length; i++) {
        const msg = newMessages[i];
        const prevMsg = i > 0 ? newMessages[i - 1] : null;

        const detected = this.detectPatterns(msg, prevMsg, sessionId, projectPath);
        patterns.push(...detected);
      }

      // Store patterns in DB
      for (const pattern of patterns) {
        this.db.createPattern(pattern);
      }

      // Try to propose rules from accumulated patterns
      if (patterns.length > 0) {
        await this.proposeRulesFromPatterns(sessionId);
      }

    } catch (err) {
      console.error(`[analyzer] Error analyzing ${sessionPath}:`, err);
    }

    return patterns;
  }

  /**
   * Detect patterns in a message
   */
  private detectPatterns(
    msg: SessionMessage,
    prevMsg: SessionMessage | null,
    sessionId: string,
    projectPath: string
  ): Pattern[] {
    const patterns: Pattern[] = [];

    if (msg.message?.role !== 'user') return patterns;

    const content = this.extractContent(msg.message.content);
    if (!content) return patterns;

    // Check for corrections
    for (const pattern of CORRECTION_PATTERNS) {
      if (pattern.test(content)) {
        patterns.push({
          id: createPatternId(),
          sessionId,
          type: 'correction',
          content,
          context: prevMsg ? this.extractContent(prevMsg.message?.content) || '' : '',
          projectPath,
          detectedAt: Date.now(),
        });
        break;
      }
    }

    // Check for retries
    for (const pattern of RETRY_PATTERNS) {
      if (pattern.test(content)) {
        patterns.push({
          id: createPatternId(),
          sessionId,
          type: 'retry',
          content,
          context: prevMsg ? this.extractContent(prevMsg.message?.content) || '' : '',
          projectPath,
          detectedAt: Date.now(),
        });
        break;
      }
    }

    return patterns;
  }

  /**
   * Extract text content from message
   */
  private extractContent(content: string | Array<{ type: string; text?: string }> | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text)
        .join(' ');
    }
    return '';
  }

  /**
   * Propose rules from accumulated patterns
   */
  private async proposeRulesFromPatterns(sessionId: string): Promise<void> {
    // Get recent patterns for this session
    const patterns = this.db.getPatterns({ sessionId });
    
    // Need at least 1 correction to try proposing
    if (patterns.length < 1) return;

    for (const pattern of patterns) {
      // Try to extract a rule from the correction
      const ruleText = this.extractRuleText(pattern.content);
      if (!ruleText) continue;

      // Check if similar rule already exists
      const existing = this.db.getRules({ states: ['active', 'proposed'] as any })
        .find(r => this.isSimilarRule(r.text, ruleText));

      if (existing) {
        console.log(`[analyzer] Similar rule already exists: "${existing.text.slice(0, 50)}..."`);
        continue;
      }

      // Create proposed rule
      const rule = {
        id: createRuleId(),
        text: ruleText,
        scope: pattern.projectPath ? 'project' as const : 'global' as const,
        scopeTarget: pattern.projectPath,
        state: 'proposed' as const,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        sourcePatterns: [pattern.id],
        opportunities: 0,
        followed: 0,
        violated: 0,
      };
      
      this.db.createRule(rule);
      console.log(`[analyzer] 📋 Proposed rule: "${rule.text.slice(0, 50)}..."`);
    }
  }
  
  /**
   * Extract actionable rule text from correction content
   */
  private extractRuleText(content: string): string | null {
    // "don't X" → "Don't X"
    const dontMatch = content.match(/don'?t\s+(.+?)(?:\.|,|!|$)/i);
    if (dontMatch) return `Don't ${dontMatch[1]}`;
    
    // "use X instead" → "Use X"
    const useMatch = content.match(/use\s+(.+?)\s+instead/i);
    if (useMatch) return `Use ${useMatch[1]}`;
    
    // "always X" → "Always X"
    const alwaysMatch = content.match(/always\s+(.+?)(?:\.|,|!|$)/i);
    if (alwaysMatch) return `Always ${alwaysMatch[1]}`;
    
    // "never X" → "Never X"
    const neverMatch = content.match(/never\s+(.+?)(?:\.|,|!|$)/i);
    if (neverMatch) return `Never ${neverMatch[1]}`;
    
    // "prefer X over Y" → "Prefer X over Y"
    const preferMatch = content.match(/prefer\s+(.+?)\s+over\s+(.+?)(?:\.|,|!|$)/i);
    if (preferMatch) return `Prefer ${preferMatch[1]} over ${preferMatch[2]}`;
    
    return null;
  }

  /**
   * Check if two rules are similar
   */
  private isSimilarRule(a: string, b: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const aNorm = normalize(a);
    const bNorm = normalize(b);
    
    // Simple similarity check
    const aWords = new Set(aNorm.split(/\s+/));
    const bWords = new Set(bNorm.split(/\s+/));
    
    let overlap = 0;
    for (const word of aWords) {
      if (bWords.has(word)) overlap++;
    }
    
    return overlap / Math.max(aWords.size, bWords.size) > 0.7;
  }

  /**
   * Reset analysis state for a session
   */
  resetSession(sessionId: string): void {
    this.analyzedMessages.delete(sessionId);
  }
}

// Singleton
export const sessionAnalyzer = new SessionAnalyzer();
