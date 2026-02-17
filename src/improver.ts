import chalk from 'chalk';
import { AnalysisResult, CorrectionPattern } from './analyzer.js';

export interface Improvement {
  category: string;
  rule: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  source?: string;
}

export interface ImprovementResult {
  improvements: Improvement[];
  claudeMdSuggestion: string;
  rawPatterns: CorrectionPattern[];
}

const SYSTEM_PROMPT = `You are an expert at analyzing developer-AI interaction patterns and creating actionable rules.

You will receive a list of "correction patterns" - moments where a developer had to correct, redirect, or fix something the AI assistant did wrong.

Your job is to extract ACTIONABLE RULES for a CLAUDE.md file. CLAUDE.md is read by AI coding assistants to understand project-specific conventions and avoid repeating mistakes.

RULES FOR GOOD RULES:
1. Be SPECIFIC and ACTIONABLE - "Use single quotes in TypeScript" not "Follow code style"
2. Focus on PATTERNS that repeat - one-off issues aren't worth documenting
3. Include the WHY when helpful - "Always run tests before committing (CI is strict)"
4. Categories: coding-style, testing, git, communication, architecture, tooling, project-specific
5. Priority: high (caused real problems), medium (annoying), low (nice to have)

BAD RULES (don't generate these):
- Too vague: "Write good code"
- Too specific: "On line 47 of app.ts, use X"
- Obvious: "Don't break the build"
- Not actionable: "Be careful with X"

Output ONLY valid JSON:
{
  "improvements": [
    {
      "category": "coding-style",
      "rule": "Use 2-space indentation in all TypeScript files",
      "reason": "User corrected indentation multiple times",
      "priority": "high"
    }
  ]
}

If the patterns don't suggest any clear, actionable rules, return {"improvements": []}`;

export async function generateImprovements(
  analysis: AnalysisResult,
  apiKey?: string
): Promise<ImprovementResult> {
  if (!apiKey) {
    return generateBasicImprovements(analysis);
  }

  // Filter to only meaningful patterns
  const meaningfulPatterns = analysis.patterns
    .filter(p => p.confidence === 'high' || (p.confidence === 'medium' && p.frequency > 1))
    .slice(0, 15);

  if (meaningfulPatterns.length === 0) {
    return {
      improvements: [],
      claudeMdSuggestion: formatClaudeMd([]),
      rawPatterns: analysis.patterns
    };
  }

  // Prepare patterns with context
  const patternSummary = meaningfulPatterns.map(p => ({
    type: p.type,
    userCorrection: p.userMessage,
    whatAiDid: p.assistantContext ? p.assistantContext.slice(0, 300) : '(no context)',
    frequency: p.frequency,
    confidence: p.confidence
  }));

  try {
    // Dynamic import — openai is an optional dependency
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Analyze these ${patternSummary.length} correction patterns and generate CLAUDE.md rules:\n\n${JSON.stringify(patternSummary, null, 2)}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from API');
    }

    const result = JSON.parse(content) as { improvements: Improvement[] };
    const improvements = result.improvements || [];

    // Add source tracking
    improvements.forEach((imp, i) => {
      if (i < meaningfulPatterns.length) {
        imp.source = meaningfulPatterns[i].userMessage.slice(0, 50);
      }
    });

    return {
      improvements,
      claudeMdSuggestion: formatClaudeMd(improvements),
      rawPatterns: analysis.patterns
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Distinguish between "openai not installed" vs API errors
    if (errorMsg.includes('Cannot find module') || errorMsg.includes('MODULE_NOT_FOUND')) {
      console.log(chalk.yellow('openai package not installed — using local analysis'));
    } else {
      console.error(chalk.yellow(`AI analysis failed (${errorMsg}), using local analysis`));
    }
    return generateBasicImprovements(analysis);
  }
}

function generateBasicImprovements(analysis: AnalysisResult): ImprovementResult {
  const improvements: Improvement[] = [];

  // Process all high-confidence patterns, and medium with frequency > 1
  const significant = analysis.patterns
    .filter(p => p.confidence === 'high' || (p.confidence === 'medium' && p.frequency > 1))
    .slice(0, 10);

  for (const pattern of significant) {
    const msg = pattern.userMessage.toLowerCase();

    // "don't X" / "stop X" / "never X" → prohibition rule
    if (msg.includes("don't") || msg.includes("do not") || msg.includes("stop") || msg.includes("never")) {
      improvements.push({
        category: categorizeCorrection(pattern),
        rule: extractNegativeRule(pattern.userMessage),
        reason: pattern.frequency > 1
          ? `User explicitly said this ${pattern.frequency} times`
          : 'User correction (high confidence)',
        priority: pattern.frequency >= 3 ? 'high' : pattern.frequency >= 2 ? 'high' : 'medium',
        source: pattern.userMessage.slice(0, 50)
      });
    }
    // "use X instead of Y" → preference rule
    else if (/use\s+\S+\s+instead/i.test(msg)) {
      const match = pattern.userMessage.match(/use\s+(\S+)\s+instead\s+of\s+(\S+)/i);
      if (match) {
        improvements.push({
          category: categorizeCorrection(pattern),
          rule: `Use ${match[1]} instead of ${match[2]}`,
          reason: pattern.frequency > 1
            ? `Repeated preference (${pattern.frequency}x)`
            : 'User correction (high confidence)',
          priority: pattern.frequency >= 2 ? 'high' : 'medium',
          source: pattern.userMessage.slice(0, 50)
        });
      }
    }
    // "always X" / "make sure" / "remember to" → positive rule
    else if (msg.includes('always') || msg.includes('make sure') || msg.includes('remember to')) {
      improvements.push({
        category: categorizeCorrection(pattern),
        rule: extractPositiveRule(pattern.userMessage),
        reason: pattern.frequency > 1
          ? `Repeated instruction (${pattern.frequency}x)`
          : 'User instruction (high confidence)',
        priority: pattern.frequency >= 2 ? 'high' : 'medium',
        source: pattern.userMessage.slice(0, 50)
      });
    }
    // "that's wrong" / "I meant" / rollback → context-dependent rule
    else if (pattern.type === 'correction' && pattern.confidence === 'high') {
      improvements.push({
        category: categorizeCorrection(pattern),
        rule: extractGeneralRule(pattern),
        reason: pattern.frequency > 1
          ? `User corrected this ${pattern.frequency} times`
          : 'User correction',
        priority: pattern.frequency >= 2 ? 'high' : 'medium',
        source: pattern.userMessage.slice(0, 50)
      });
    }
    // Failed commands → tooling rule
    else if (pattern.type === 'failed_command') {
      improvements.push({
        category: 'tooling',
        rule: `Watch out for: ${pattern.userMessage.slice(0, 100)}`,
        reason: pattern.frequency > 1
          ? `This error occurred ${pattern.frequency} times`
          : 'Recurring error pattern',
        priority: 'medium',
        source: pattern.userMessage.slice(0, 50)
      });
    }
  }

  return {
    improvements,
    claudeMdSuggestion: formatClaudeMd(improvements),
    rawPatterns: analysis.patterns
  };
}

// Categorize a correction based on its content
function categorizeCorrection(pattern: CorrectionPattern): string {
  const combined = (pattern.userMessage + ' ' + pattern.assistantContext).toLowerCase();

  if (/\b(indent|tab|space|quote|semicolon|bracket|format|lint|prettier|eslint)\b/.test(combined)) {
    return 'coding-style';
  }
  if (/\b(test|spec|jest|vitest|mocha|assert|expect|coverage)\b/.test(combined)) {
    return 'testing';
  }
  if (/\b(commit|push|branch|merge|rebase|git|pr|pull request)\b/.test(combined)) {
    return 'git';
  }
  if (/\b(import|export|module|package|component|architecture|pattern|refactor)\b/.test(combined)) {
    return 'architecture';
  }
  if (/\b(npm|yarn|pnpm|bun|docker|build|deploy|ci|cd|script)\b/.test(combined)) {
    return 'tooling';
  }
  if (pattern.scope === 'file') return 'project-specific';

  return 'general';
}

// Extract a general rule from a correction pattern
function extractGeneralRule(pattern: CorrectionPattern): string {
  const msg = pattern.userMessage;

  // "I meant X" → extract what was meant
  const meantMatch = msg.match(/I\s+meant\s+(.{10,80}?)(?:\.|!|$)/i);
  if (meantMatch) return meantMatch[1].trim();

  // "not what I asked" → use the correction as context
  if (/not\s+what\s+I\s+(asked|wanted|meant)/i.test(msg)) {
    return msg.slice(0, 100);
  }

  // Fallback: use the correction text directly
  return msg.length > 100 ? msg.slice(0, 97) + '...' : msg;
}

function extractNegativeRule(message: string): string {
  const match = message.match(/(?:don'?t|do not|stop|never)\s+(.{10,80}?)(?:\.|!|$)/i);
  if (match) {
    return `Do not ${match[1].trim()}`;
  }
  return `Avoid: ${message.slice(0, 80)}`;
}

function extractPositiveRule(message: string): string {
  const match = message.match(/(?:always|make sure|remember to)\s+(.{10,80}?)(?:\.|!|$)/i);
  if (match) {
    return match[1].trim().charAt(0).toUpperCase() + match[1].trim().slice(1);
  }
  return message.slice(0, 80);
}

function formatClaudeMd(improvements: Improvement[]): string {
  if (improvements.length === 0) {
    return `# CLAUDE.md

> Generated by claude-learner

No actionable patterns found yet. Keep using Claude Code and run analysis again after a few sessions!

## Tips
- Make corrections explicit: "No, don't do X" instead of just redoing manually
- Explain why: "Use Y because Z" helps the AI learn
- Be consistent: Same feedback multiple times = stronger signal
`;
  }

  const sections = new Map<string, Improvement[]>();

  for (const imp of improvements) {
    const category = imp.category || 'general';
    if (!sections.has(category)) {
      sections.set(category, []);
    }
    sections.get(category)!.push(imp);
  }

  const lines: string[] = [
    '# CLAUDE.md',
    '',
    '> Auto-generated by [claude-learner](https://github.com/unisone/claude-learner)',
    '> Review and customize as needed.',
    ''
  ];

  // Sort sections: high-priority categories first
  const categoryOrder = ['coding-style', 'architecture', 'testing', 'git', 'tooling', 'communication', 'project-specific', 'general'];
  const sortedSections = [...sections.entries()].sort((a, b) => {
    const aIdx = categoryOrder.indexOf(a[0]);
    const bIdx = categoryOrder.indexOf(b[0]);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  for (const [category, items] of sortedSections) {
    const title = category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    lines.push(`## ${title}`);
    lines.push('');

    // Sort by priority
    const sorted = items.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });

    for (const item of sorted) {
      const priority = item.priority === 'high' ? '🔴' : item.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`- ${priority} **${item.rule}**`);
      if (item.reason) {
        lines.push(`  - _${item.reason}_`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatImprovementResult(result: ImprovementResult): string {
  const lines: string[] = [
    chalk.bold.cyan('\n📝 Generated Improvements\n'),
    chalk.dim('─'.repeat(50)),
    ''
  ];

  if (result.improvements.length === 0) {
    lines.push(chalk.yellow('No actionable improvements generated.'));
    lines.push('');
    lines.push(chalk.dim('This could mean:'));
    lines.push(chalk.dim('  • Your sessions don\'t have clear correction patterns'));
    lines.push(chalk.dim('  • The patterns found were too vague to create rules'));
    lines.push(chalk.dim('  • You\'re already doing great! 🎉'));
    lines.push('');
    lines.push(chalk.dim('Tip: Make corrections explicit - "No, use X instead of Y"'));
  } else {
    const byPriority = {
      high: result.improvements.filter(i => i.priority === 'high'),
      medium: result.improvements.filter(i => i.priority === 'medium'),
      low: result.improvements.filter(i => i.priority === 'low')
    };

    if (byPriority.high.length > 0) {
      lines.push(chalk.red.bold('🔴 High Priority Rules:\n'));
      for (const imp of byPriority.high) {
        lines.push(`  ${chalk.white(imp.rule)}`);
        lines.push(chalk.dim(`    → ${imp.reason}`));
        lines.push('');
      }
    }

    if (byPriority.medium.length > 0) {
      lines.push(chalk.yellow.bold('🟡 Medium Priority Rules:\n'));
      for (const imp of byPriority.medium) {
        lines.push(`  ${chalk.white(imp.rule)}`);
        lines.push(chalk.dim(`    → ${imp.reason}`));
        lines.push('');
      }
    }

    if (byPriority.low.length > 0) {
      lines.push(chalk.green.bold('🟢 Nice to Have:\n'));
      for (const imp of byPriority.low) {
        lines.push(`  ${chalk.white(imp.rule)}`);
        lines.push('');
      }
    }
  }

  lines.push(chalk.dim('─'.repeat(50)));
  lines.push('');
  lines.push(chalk.bold('📄 CLAUDE.md Output:'));
  lines.push('');
  lines.push(chalk.gray('```markdown'));
  lines.push(result.claudeMdSuggestion);
  lines.push(chalk.gray('```'));

  return lines.join('\n');
}
