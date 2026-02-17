import { describe, it, expect } from 'vitest';
import {
  getComplianceRate,
  shouldAutoPrune,
  getRulePriority,
  createRuleId,
  createPatternId,
  rowToRule,
  ruleToRow,
  rowToPattern,
  patternToRow,
  rowToSession,
  sessionToRow,
} from '../types.js';
import type { Rule, RuleRow, Pattern, PatternRow, Session, SessionRow } from '../types.js';

// ── Helper ──────────────────────────────────────────

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule_test_1',
    text: 'Use trash instead of rm',
    scope: 'global',
    state: 'active',
    createdAt: 1000,
    lastSeenAt: 2000,
    sourcePatterns: ['pat_1'],
    opportunities: 0,
    followed: 0,
    violated: 0,
    ...overrides,
  };
}

// ── Compliance Rate ─────────────────────────────────

describe('getComplianceRate', () => {
  it('returns 1 when no opportunities', () => {
    expect(getComplianceRate(makeRule())).toBe(1);
  });

  it('returns correct rate', () => {
    const rule = makeRule({ opportunities: 10, followed: 7, violated: 3 });
    expect(getComplianceRate(rule)).toBeCloseTo(0.7);
  });

  it('returns 0 when never followed', () => {
    const rule = makeRule({ opportunities: 5, followed: 0, violated: 5 });
    expect(getComplianceRate(rule)).toBe(0);
  });

  it('returns 1 when always followed', () => {
    const rule = makeRule({ opportunities: 5, followed: 5, violated: 0 });
    expect(getComplianceRate(rule)).toBe(1);
  });
});

// ── Auto-Prune ──────────────────────────────────────

describe('shouldAutoPrune', () => {
  it('returns false with insufficient opportunities', () => {
    const rule = makeRule({ opportunities: 5, followed: 0, violated: 5 });
    expect(shouldAutoPrune(rule)).toBe(false);
  });

  it('returns true when compliance < 30% and >= 10 opportunities', () => {
    const rule = makeRule({ opportunities: 10, followed: 2, violated: 8 });
    expect(shouldAutoPrune(rule)).toBe(true);
  });

  it('returns false when compliance >= 30%', () => {
    const rule = makeRule({ opportunities: 10, followed: 5, violated: 5 });
    expect(shouldAutoPrune(rule)).toBe(false);
  });
});

// ── Rule Priority ───────────────────────────────────

describe('getRulePriority', () => {
  it('returns high for >= 80% compliance', () => {
    expect(getRulePriority(makeRule({ opportunities: 10, followed: 9, violated: 1 }))).toBe('high');
  });

  it('returns medium for 50-79% compliance', () => {
    expect(getRulePriority(makeRule({ opportunities: 10, followed: 6, violated: 4 }))).toBe('medium');
  });

  it('returns low for < 50% compliance', () => {
    expect(getRulePriority(makeRule({ opportunities: 10, followed: 3, violated: 7 }))).toBe('low');
  });
});

// ── ID Generators ───────────────────────────────────

describe('createRuleId', () => {
  it('starts with rule_', () => {
    expect(createRuleId()).toMatch(/^rule_/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createRuleId()));
    expect(ids.size).toBe(20);
  });
});

describe('createPatternId', () => {
  it('starts with pat_', () => {
    expect(createPatternId()).toMatch(/^pat_/);
  });
});

// ── Row Converters ──────────────────────────────────

describe('rowToRule / ruleToRow', () => {
  it('round-trips correctly', () => {
    const rule = makeRule({ scopeTarget: '/my/project' });
    const row = ruleToRow(rule);
    const back = rowToRule(row);
    expect(back).toEqual(rule);
  });

  it('converts null scope_target to undefined', () => {
    const row: RuleRow = {
      id: 'r1',
      text: 'test',
      scope: 'global',
      scope_target: null,
      state: 'active',
      created_at: 1,
      last_seen_at: 2,
      source_patterns: '[]',
      opportunities: 0,
      followed: 0,
      violated: 0,
    };
    const rule = rowToRule(row);
    expect(rule.scopeTarget).toBeUndefined();
  });

  it('serializes sourcePatterns as JSON', () => {
    const rule = makeRule({ sourcePatterns: ['p1', 'p2'] });
    const row = ruleToRow(rule);
    expect(row.source_patterns).toBe('["p1","p2"]');
  });
});

describe('rowToPattern / patternToRow', () => {
  it('round-trips correctly', () => {
    const pattern: Pattern = {
      id: 'pat_1',
      sessionId: 'sess_1',
      type: 'correction',
      content: 'test content',
      context: 'test context',
      projectPath: '/project',
      filePath: '/file.ts',
      detectedAt: 1000,
    };
    const row = patternToRow(pattern);
    const back = rowToPattern(row);
    expect(back).toEqual(pattern);
  });

  it('converts null paths to undefined', () => {
    const row: PatternRow = {
      id: 'p1',
      session_id: 's1',
      type: 'correction',
      content: 'c',
      context: 'x',
      project_path: null,
      file_path: null,
      detected_at: 1,
    };
    const pattern = rowToPattern(row);
    expect(pattern.projectPath).toBeUndefined();
    expect(pattern.filePath).toBeUndefined();
  });
});

describe('rowToSession / sessionToRow', () => {
  it('round-trips correctly', () => {
    const session: Session = {
      id: 'sess_1',
      projectPath: '/project',
      startedAt: 1000,
      endedAt: 2000,
      messageCount: 42,
    };
    const row = sessionToRow(session);
    const back = rowToSession(row);
    expect(back).toEqual(session);
  });

  it('handles missing endedAt', () => {
    const session: Session = {
      id: 'sess_1',
      projectPath: '/project',
      startedAt: 1000,
      messageCount: 0,
    };
    const row = sessionToRow(session);
    expect(row.ended_at).toBeNull();
    const back = rowToSession(row);
    expect(back.endedAt).toBeUndefined();
  });
});
