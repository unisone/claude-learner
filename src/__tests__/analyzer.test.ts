import { describe, it, expect } from 'vitest';
import { analyzeSession, aggregatePatterns, analyzeSessions } from '../analyzer.js';
import type { CorrectionPattern } from '../analyzer.js';
import type { AnalysisSession, SessionMessage } from '../utils.js';

// ── Helpers ─────────────────────────────────────────

function makeSession(messages: SessionMessage[], path = '/home/.claude/projects/test-project/session.jsonl'): AnalysisSession {
  return {
    path,
    projectPath: '/home/user/my-project',
    messages,
    timestamp: new Date(),
  };
}

function userMsg(content: string): SessionMessage {
  return { type: 'message', message: { role: 'user', content } };
}

function assistantMsg(content: string): SessionMessage {
  return { type: 'message', message: { role: 'assistant', content } };
}

function toolResult(content: string, error?: string): SessionMessage {
  return {
    type: 'tool_result',
    result: error ? { error } : { assistant: content },
  } as unknown as SessionMessage;
}

// ── analyzeSession: High-confidence corrections ─────

describe('analyzeSession', () => {
  it('detects "don\'t do that" corrections', () => {
    const session = makeSession([
      assistantMsg('I will use rm to delete the file'),
      userMsg("Don't do that, use trash instead of rm"),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('correction');
    expect(patterns[0].confidence).toBe('high');
  });

  it('detects "that\'s wrong" corrections', () => {
    const session = makeSession([
      assistantMsg('Here is the implementation using any type'),
      userMsg("That's wrong, don't use any type in this codebase"),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.confidence === 'high')).toBe(true);
  });

  it('detects "undo that" corrections', () => {
    const session = makeSession([
      assistantMsg('I renamed the variable'),
      userMsg('Undo that, I liked the old name better'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.type === 'correction')).toBe(true);
  });

  it('detects "revert this" corrections', () => {
    const session = makeSession([
      assistantMsg('Refactored the component'),
      userMsg('Revert this change immediately'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.type === 'correction')).toBe(true);
  });

  it('detects "I already said" corrections', () => {
    const session = makeSession([
      assistantMsg('Using tabs for indentation'),
      userMsg('I already said to use spaces for indentation in the code'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.confidence === 'high')).toBe(true);
  });

  it('detects "fix that" corrections', () => {
    const session = makeSession([
      assistantMsg('Added the import statement'),
      userMsg('Fix that, the import path is wrong in the file'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.type === 'correction')).toBe(true);
  });

  it('detects "try again" corrections', () => {
    const session = makeSession([
      assistantMsg('Here is the solution using lodash'),
      userMsg('Try again, we should not use lodash in this code project'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.confidence === 'high')).toBe(true);
  });

  // ── Medium-confidence corrections ───────────────

  it('detects "actually" in dev context as medium-confidence', () => {
    const session = makeSession([
      assistantMsg('I used axios for the API call in the code'),
      userMsg('Actually, we use fetch in this codebase, not axios'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.confidence === 'medium')).toBe(true);
  });

  it('does NOT detect "actually" in non-dev context as correction', () => {
    const session = makeSession([
      assistantMsg('The weather is nice today'),
      userMsg('Actually, it is raining outside'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.filter(p => p.type === 'correction')).toHaveLength(0);
  });

  // ── False-positive filtering ────────────────────

  it('filters out short messages', () => {
    const session = makeSession([
      assistantMsg('Done'),
      userMsg('No'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.filter(p => p.type === 'correction')).toHaveLength(0);
  });

  it('filters out casual chat', () => {
    const session = makeSession([
      assistantMsg('Here is the result'),
      userMsg('Thanks!'),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.filter(p => p.type === 'correction')).toHaveLength(0);
  });

  it('requires assistant context for corrections', () => {
    const session = makeSession([
      userMsg("Don't use rm, use trash instead for safety in the project"),
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.filter(p => p.type === 'correction')).toHaveLength(0);
  });

  // ── Failed command detection ────────────────────

  it('detects errors in result.error', () => {
    // result.error lives on non-user messages (assistant results)
    const session = makeSession([
      { type: 'result', result: { error: 'npm ERR! Missing script: "build-prod" — check package.json' } } as unknown as SessionMessage,
    ]);
    const patterns = analyzeSession(session);
    expect(patterns.some(p => p.type === 'failed_command')).toBe(true);
  });

  // ── Context extraction ──────────────────────────

  it('extracts file references from corrections', () => {
    const session = makeSession([
      assistantMsg('I modified `src/utils.ts` to fix the bug'),
      userMsg("That's wrong, you should have changed `src/helpers.ts` instead"),
    ]);
    const patterns = analyzeSession(session);
    const correction = patterns.find(p => p.type === 'correction');
    expect(correction?.fileContext).toBeDefined();
    expect(correction!.fileContext!.length).toBeGreaterThan(0);
  });

  it('extracts project name from session path', () => {
    const session = makeSession(
      [
        assistantMsg('Working on it'),
        userMsg("Stop! That's not what I asked for in this code project"),
      ],
      '/home/.claude/projects/my-awesome-project/sessions/abc.jsonl'
    );
    const patterns = analyzeSession(session);
    const correction = patterns.find(p => p.type === 'correction');
    expect(correction?.projectName).toBe('my-awesome-project');
  });
});

// ── aggregatePatterns ───────────────────────────────

describe('aggregatePatterns', () => {
  it('groups similar patterns and increments frequency', () => {
    const patterns: CorrectionPattern[] = [
      {
        type: 'correction',
        userMessage: "Don't use rm",
        assistantContext: 'ctx',
        sessionPath: '/s1',
        frequency: 1,
        confidence: 'high',
        scope: 'global',
      },
      {
        type: 'correction',
        userMessage: "Don't use rm",
        assistantContext: 'ctx2',
        sessionPath: '/s2',
        frequency: 1,
        confidence: 'high',
        scope: 'global',
      },
    ];
    const aggregated = aggregatePatterns(patterns);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].frequency).toBe(2);
  });

  it('sorts by confidence then frequency', () => {
    const patterns: CorrectionPattern[] = [
      {
        type: 'correction',
        userMessage: 'medium pattern that is interesting',
        assistantContext: 'ctx',
        sessionPath: '/s1',
        frequency: 5,
        confidence: 'medium',
        scope: 'global',
      },
      {
        type: 'correction',
        userMessage: 'high confidence pattern that is important',
        assistantContext: 'ctx',
        sessionPath: '/s1',
        frequency: 1,
        confidence: 'high',
        scope: 'global',
      },
    ];
    const aggregated = aggregatePatterns(patterns);
    expect(aggregated[0].confidence).toBe('high');
  });
});

// ── analyzeSessions ─────────────────────────────────

describe('analyzeSessions', () => {
  it('returns correct totals', () => {
    const sessions = [
      makeSession([
        assistantMsg('did something'),
        userMsg("That's wrong, please fix that code right now"),
      ]),
      makeSession([
        assistantMsg('another thing'),
        userMsg('Revert that change in the code immediately'),
      ]),
    ];
    const result = analyzeSessions(sessions);
    expect(result.totalSessions).toBe(2);
    expect(result.totalMessages).toBe(4);
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it('generates a summary', () => {
    const sessions = [
      makeSession([
        assistantMsg('did something'),
        userMsg("That's wrong and incorrect, fix the code now"),
      ]),
    ];
    const result = analyzeSessions(sessions);
    expect(result.summary).toContain('Analyzed 1 sessions');
  });

  it('filters out low-confidence patterns', () => {
    const sessions = [
      makeSession([
        assistantMsg('I wrote some code'),
        userMsg("That's wrong, please undo that change in the code"),
      ]),
    ];
    const result = analyzeSessions(sessions);
    expect(result.patterns.every(p => p.confidence !== 'low')).toBe(true);
  });
});
