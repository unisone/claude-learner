import chalk from 'chalk';
import { Session, SessionMessage, extractTextContent } from './utils.js';

export interface CorrectionPattern {
  type: 'correction' | 'rollback' | 'retry' | 'failed_command' | 'repeated_ask';
  userMessage: string;
  assistantContext: string;
  sessionPath: string;
  frequency: number;
  confidence: 'high' | 'medium' | 'low';
  // Context-aware fields (v1.1)
  projectName?: string;
  fileContext?: string[];  // Files mentioned in correction
  scope?: 'global' | 'project' | 'file';
}

export interface AnalysisResult {
  totalSessions: number;
  totalMessages: number;
  patterns: CorrectionPattern[];
  summary: string;
}

// High-confidence correction patterns (user is clearly correcting)
const HIGH_CONFIDENCE_CORRECTIONS = [
  /\bthat'?s\s+(not\s+)?(wrong|incorrect)\b/i,
  /\bno[,.]?\s+(that'?s\s+)?(not|wrong|incorrect)\b/i,
  /\bdon'?t\s+do\s+that\b/i,
  /\bstop[!.]?\s/i,
  /\bundo\s+(that|this|it)\b/i,
  /\brevert\s+(that|this|it|the|to)\b/i,
  /\brollback\b/i,
  /\bI\s+(already\s+)?(said|told\s+you|mentioned)\b/i,
  /\bI\s+meant\b/i,
  /\bchange\s+it\s+back\b/i,
  /\btry\s+again\b/i,
  /\bwhy\s+did\s+you\b.*\?/i,
  /\bthat\s+broke\b/i,
  /\byou\s+(just\s+)?broke\b/i,
  /\bfix\s+(that|this|it)\b/i,
  /\bnot\s+what\s+I\s+(asked|wanted|meant)\b/i,
  /\bI\s+didn'?t\s+(ask|want|mean)\b/i,
];

// Medium-confidence patterns (might be corrections)
const MEDIUM_CONFIDENCE_CORRECTIONS = [
  /\bactually[,.]?\s/i,
  /\blet\s+me\s+clarify\b/i,
  /\bto\s+be\s+clear\b/i,
  /\bwait[,.]?\s/i,
  /\bhold\s+on\b/i,
  /\bno[,.]?\s+I\b/i,
  /\bplease\s+(don'?t|stop|fix)\b/i,
];

// Patterns indicating failed commands/operations
const FAILURE_PATTERNS = [
  /error:/i,
  /Error:/,
  /failed/i,
  /FAILED/,
  /command\s+not\s+found/i,
  /permission\s+denied/i,
  /cannot\s+find/i,
  /No\s+such\s+file/i,
  /ENOENT/,
  /EACCES/,
  /exception/i,
  /Traceback/,
  /npm\s+ERR!/i,
  /fatal:/i,
  /SyntaxError/,
  /TypeError/,
  /ReferenceError/,
  /Cannot read propert/,
  /is not defined/,
  /Module not found/,
  /Build failed/i,
  /Compilation failed/i,
  /Test failed/i,
];

// Extract file references from content
function extractFileReferences(content: string): string[] {
  const files: Set<string> = new Set();
  
  // Match common file patterns
  const patterns = [
    /[`"']([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|py|md|json|yaml|yml|css|html|go|rs|rb|java|c|cpp|h))[`"']/g,
    /\b(src\/[a-zA-Z0-9_\-./]+)/g,
    /\b(components\/[a-zA-Z0-9_\-./]+)/g,
    /\b(pages\/[a-zA-Z0-9_\-./]+)/g,
    /\b(lib\/[a-zA-Z0-9_\-./]+)/g,
    /\b(app\/[a-zA-Z0-9_\-./]+)/g,
  ];
  
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length < 100) {
        files.add(match[1]);
      }
    }
  }
  
  return Array.from(files).slice(0, 5); // Max 5 files
}

// Extract project name from session path
function extractProjectName(sessionPath: string): string {
  // Path format: ~/.claude/projects/<project-hash>/sessions/<session>.jsonl
  // or: ~/.claude/projects/<project-hash>/<session>.jsonl
  const parts = sessionPath.split('/');
  const projectsIdx = parts.indexOf('projects');
  if (projectsIdx !== -1 && parts[projectsIdx + 1]) {
    // Return the project folder name (usually a hash or project name)
    return parts[projectsIdx + 1];
  }
  return 'unknown';
}

// Determine scope based on file references
function determineScope(fileRefs: string[]): 'global' | 'project' | 'file' {
  if (fileRefs.length === 0) return 'global';
  if (fileRefs.length === 1) return 'file';
  return 'project';
}

// Check if message looks like a coding/development context
function isDevContext(content: string): boolean {
  const devIndicators = [
    /\bcode\b/i, /\bfunction\b/i, /\bfile\b/i, /\bcomponent\b/i,
    /\bapi\b/i, /\btest\b/i, /\bbuild\b/i, /\bcommit\b/i,
    /\berror\b/i, /\bbug\b/i, /\bfix\b/i, /\brefactor\b/i,
    /\bimport\b/i, /\bexport\b/i, /\bmodule\b/i, /\bpackage\b/i,
    /\brun\b/i, /\binstall\b/i, /\bdeploy\b/i,
    /\.ts\b/, /\.js\b/, /\.tsx\b/, /\.jsx\b/, /\.py\b/, /\.md\b/,
    /```/, /`[^`]+`/,
  ];
  return devIndicators.some(p => p.test(content));
}

// Filter out false positives
function isLikelyFalsePositive(content: string, context: string): boolean {
  const contentLower = content.toLowerCase();
  
  // Too short to be meaningful
  if (content.length < 15) return true;
  
  // Looks like casual chat, not a correction
  const casualPatterns = [
    /^(hi|hey|hello|thanks|thank you|ok|okay|sure|yes|yep|yeah|no worries)/i,
    /^(good morning|good night|gm|gn)/i,
    /\b(lol|haha|lmao)\b/i,
    /^(nice|cool|great|awesome|perfect)[\s!.]*$/i,
  ];
  if (casualPatterns.some(p => p.test(content))) return true;
  
  // Check if it's actually a question, not a correction
  if (content.endsWith('?') && !content.includes('why did you')) return true;
  
  // If talking about external things (not correcting the AI)
  const externalTopics = [
    /\b(twitter|x\.com|reddit|news|article|post|someone)\b/i,
    /\b(saw|read|heard|found)\s+(this|that|a)\b/i,
  ];
  if (externalTopics.some(p => p.test(content)) && !isDevContext(content)) return true;
  
  return false;
}

export function analyzeSession(session: Session): CorrectionPattern[] {
  const patterns: CorrectionPattern[] = [];
  const messages = session.messages;
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Analyze user messages for corrections
    if (msg.message?.role === 'user') {
      const content = extractTextContent(msg.message.content);
      
      // Skip likely false positives
      if (isLikelyFalsePositive(content, '')) continue;
      
      // Get context (previous assistant message)
      let assistantContext = '';
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const prevMsg = messages[j];
        if (prevMsg.message?.role === 'assistant' || prevMsg.result?.assistant) {
          const assistantContent = prevMsg.message?.content 
            ? extractTextContent(prevMsg.message.content)
            : prevMsg.result?.assistant || '';
          assistantContext = assistantContent.slice(0, 500);
          break;
        }
      }
      
      // Must have assistant context to be a correction
      if (!assistantContext) continue;
      
      // Extract context info
      const projectName = extractProjectName(session.path);
      const fileRefs = extractFileReferences(content + ' ' + assistantContext);
      const scope = determineScope(fileRefs);
      
      // Check high-confidence patterns
      for (const pattern of HIGH_CONFIDENCE_CORRECTIONS) {
        if (pattern.test(content)) {
          patterns.push({
            type: 'correction',
            userMessage: content.slice(0, 400),
            assistantContext,
            sessionPath: session.path,
            frequency: 1,
            confidence: 'high',
            projectName,
            fileContext: fileRefs,
            scope
          });
          break;
        }
      }
      
      // Check medium-confidence patterns (only if in dev context)
      if (!patterns.find(p => p.userMessage === content.slice(0, 400))) {
        for (const pattern of MEDIUM_CONFIDENCE_CORRECTIONS) {
          if (pattern.test(content) && isDevContext(content + assistantContext)) {
            patterns.push({
              type: 'correction',
              userMessage: content.slice(0, 400),
              assistantContext,
              sessionPath: session.path,
              frequency: 1,
              confidence: 'medium',
              projectName,
              fileContext: fileRefs,
              scope
            });
            break;
          }
        }
      }
    }
    
    // Check for failed commands in results
    if (msg.result?.error) {
      const error = msg.result.error;
      if (error.length > 20) { // Skip trivial errors
        const projName = extractProjectName(session.path);
        const errFileRefs = extractFileReferences(error);
        patterns.push({
          type: 'failed_command',
          userMessage: error.slice(0, 400),
          assistantContext: '',
          sessionPath: session.path,
          frequency: 1,
          confidence: 'high',
          projectName: projName,
          fileContext: errFileRefs,
          scope: determineScope(errFileRefs)
        });
      }
    }
    
    // Check tool results for failures
    if (msg.type === 'tool_result' || msg.type === 'tool_use') {
      const content = JSON.stringify(msg);
      for (const pattern of FAILURE_PATTERNS) {
        if (pattern.test(content)) {
          // Extract relevant error info
          const match = content.match(/(?:error|Error|ERROR)[:\s]+([^\n"]{10,200})/);
          if (match) {
            const projName = extractProjectName(session.path);
            const errFileRefs = extractFileReferences(match[1]);
            patterns.push({
              type: 'failed_command',
              userMessage: match[1].slice(0, 300),
              assistantContext: '',
              sessionPath: session.path,
              frequency: 1,
              confidence: 'high',
              projectName: projName,
              fileContext: errFileRefs,
              scope: determineScope(errFileRefs)
            });
          }
          break;
        }
      }
    }
  }
  
  return patterns;
}

export function aggregatePatterns(allPatterns: CorrectionPattern[]): CorrectionPattern[] {
  const grouped = new Map<string, CorrectionPattern>();
  
  for (const pattern of allPatterns) {
    // Create a normalized key
    const normalizedMessage = pattern.userMessage
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    const key = `${pattern.type}:${pattern.confidence}:${normalizedMessage}`;
    
    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      existing.frequency++;
    } else {
      grouped.set(key, { ...pattern });
    }
  }
  
  // Sort by confidence first, then frequency
  return Array.from(grouped.values())
    .sort((a, b) => {
      const confOrder = { high: 3, medium: 2, low: 1 };
      const confDiff = confOrder[b.confidence] - confOrder[a.confidence];
      if (confDiff !== 0) return confDiff;
      return b.frequency - a.frequency;
    });
}

export function analyzeSessions(sessions: Session[]): AnalysisResult {
  let totalMessages = 0;
  const allPatterns: CorrectionPattern[] = [];
  
  for (const session of sessions) {
    totalMessages += session.messages.length;
    const sessionPatterns = analyzeSession(session);
    allPatterns.push(...sessionPatterns);
  }
  
  const patterns = aggregatePatterns(allPatterns);
  
  // Only keep high and medium confidence patterns
  const filteredPatterns = patterns.filter(p => p.confidence !== 'low');
  
  // Generate summary
  const highConfidence = filteredPatterns.filter(p => p.confidence === 'high');
  const corrections = filteredPatterns.filter(p => p.type === 'correction');
  const failures = filteredPatterns.filter(p => p.type === 'failed_command');
  
  const summary = [
    `Analyzed ${sessions.length} sessions with ${totalMessages} messages.`,
    `Found ${corrections.length} correction patterns (${highConfidence.length} high confidence).`,
    `Found ${failures.length} failure patterns.`,
    filteredPatterns.length > 0 
      ? `Top issue: "${filteredPatterns[0].userMessage.slice(0, 60)}..."`
      : 'No significant patterns detected.'
  ].join('\n');
  
  return {
    totalSessions: sessions.length,
    totalMessages,
    patterns: filteredPatterns,
    summary
  };
}

export function formatAnalysisResult(result: AnalysisResult): string {
  const lines: string[] = [
    chalk.bold.cyan('\n📊 Analysis Results\n'),
    chalk.dim('─'.repeat(50)),
    '',
    `${chalk.bold('Sessions analyzed:')} ${result.totalSessions}`,
    `${chalk.bold('Total messages:')} ${result.totalMessages}`,
    `${chalk.bold('Patterns found:')} ${result.patterns.length}`,
    '',
    chalk.dim('─'.repeat(50)),
    ''
  ];
  
  if (result.patterns.length === 0) {
    lines.push(chalk.green('✨ No significant correction patterns found!'));
    lines.push(chalk.dim('Either you\'re doing great, or you need more session history.'));
  } else {
    lines.push(chalk.bold.yellow('🔍 Patterns Found:\n'));
    
    // Group by confidence
    const highConf = result.patterns.filter(p => p.confidence === 'high').slice(0, 5);
    const medConf = result.patterns.filter(p => p.confidence === 'medium').slice(0, 3);
    
    if (highConf.length > 0) {
      lines.push(chalk.red('  High Confidence:'));
      for (const p of highConf) {
        const icon = p.type === 'correction' ? '🔄' : '❌';
        const scopeTag = p.scope === 'file' ? chalk.blue('[file]') : 
                         p.scope === 'project' ? chalk.magenta('[project]') : 
                         chalk.dim('[global]');
        lines.push(`    ${icon} ${scopeTag} ${chalk.white(p.userMessage.slice(0, 60))}...`);
        if (p.fileContext && p.fileContext.length > 0) {
          lines.push(chalk.dim(`       📁 ${p.fileContext.slice(0, 2).join(', ')}`));
        }
        if (p.frequency > 1) {
          lines.push(chalk.dim(`       (${p.frequency}x)`));
        }
      }
      lines.push('');
    }
    
    if (medConf.length > 0) {
      lines.push(chalk.yellow('  Medium Confidence:'));
      for (const p of medConf) {
        const icon = p.type === 'correction' ? '🔄' : '⚠️';
        const scopeTag = p.scope === 'file' ? chalk.blue('[file]') : 
                         p.scope === 'project' ? chalk.magenta('[project]') : 
                         chalk.dim('[global]');
        lines.push(`    ${icon} ${scopeTag} ${chalk.white(p.userMessage.slice(0, 60))}...`);
        if (p.fileContext && p.fileContext.length > 0) {
          lines.push(chalk.dim(`       📁 ${p.fileContext.slice(0, 2).join(', ')}`));
        }
      }
      lines.push('');
    }
  }
  
  return lines.join('\n');
}
