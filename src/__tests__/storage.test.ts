import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LearnerDB } from '../storage/db.js';
import { createRuleId, createPatternId } from '../types.js';
import type { Rule, Pattern, Session } from '../types.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Setup / Teardown ────────────────────────────────

let db: LearnerDB;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cl-test-'));
  db = new LearnerDB(join(tmpDir, 'test.db'));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: createRuleId(),
    text: 'Use trash instead of rm',
    scope: 'global',
    state: 'proposed',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    sourcePatterns: ['pat_1'],
    opportunities: 0,
    followed: 0,
    violated: 0,
    ...overrides,
  };
}

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: createPatternId(),
    sessionId: 'sess_1',
    type: 'correction',
    content: 'test correction',
    context: '{}',
    projectPath: '/project',
    filePath: '/project/file.ts',
    detectedAt: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `sess_${Date.now()}`,
    projectPath: '/project',
    startedAt: Date.now(),
    messageCount: 0,
    ...overrides,
  };
}

// ── Rules CRUD ──────────────────────────────────────

describe('LearnerDB - Rules', () => {
  it('creates and retrieves a rule', () => {
    const rule = makeRule();
    db.createRule(rule);
    const fetched = db.getRule(rule.id);
    expect(fetched).toEqual(rule);
  });

  it('returns null for non-existent rule', () => {
    expect(db.getRule('nope')).toBeNull();
  });

  it('updates a rule', () => {
    const rule = makeRule();
    db.createRule(rule);
    const updated = db.updateRule(rule.id, { state: 'active', text: 'Updated text' });
    expect(updated?.state).toBe('active');
    expect(updated?.text).toBe('Updated text');
  });

  it('deletes a rule', () => {
    const rule = makeRule();
    db.createRule(rule);
    expect(db.deleteRule(rule.id)).toBe(true);
    expect(db.getRule(rule.id)).toBeNull();
  });

  it('returns false deleting non-existent rule', () => {
    expect(db.deleteRule('nope')).toBe(false);
  });

  it('filters rules by state', () => {
    db.createRule(makeRule({ id: 'r1', state: 'active' }));
    db.createRule(makeRule({ id: 'r2', state: 'proposed' }));
    db.createRule(makeRule({ id: 'r3', state: 'active' }));
    expect(db.getRules({ state: 'active' })).toHaveLength(2);
    expect(db.getRules({ state: 'proposed' })).toHaveLength(1);
  });

  it('filters rules by scope', () => {
    db.createRule(makeRule({ id: 'r1', scope: 'global' }));
    db.createRule(makeRule({ id: 'r2', scope: 'project', scopeTarget: '/proj' }));
    expect(db.getRules({ scope: 'global' })).toHaveLength(1);
  });

  it('approves a rule (proposed → active)', () => {
    const rule = makeRule({ state: 'proposed' });
    db.createRule(rule);
    const approved = db.approveRule(rule.id);
    expect(approved?.state).toBe('active');
  });

  it('rejects a rule (proposed → rejected)', () => {
    const rule = makeRule({ state: 'proposed' });
    db.createRule(rule);
    const rejected = db.rejectRule(rule.id);
    expect(rejected?.state).toBe('rejected');
  });

  it('gets proposed rules', () => {
    db.createRule(makeRule({ id: 'r1', state: 'proposed' }));
    db.createRule(makeRule({ id: 'r2', state: 'active' }));
    expect(db.getProposedRules()).toHaveLength(1);
  });

  it('records followed and increments counters', () => {
    const rule = makeRule({ state: 'active' });
    db.createRule(rule);
    db.recordRuleFollowed(rule.id);
    db.recordRuleFollowed(rule.id);
    const updated = db.getRule(rule.id)!;
    expect(updated.opportunities).toBe(2);
    expect(updated.followed).toBe(2);
  });

  it('records violated and increments counters', () => {
    const rule = makeRule({ state: 'active' });
    db.createRule(rule);
    db.recordRuleViolated(rule.id);
    const updated = db.getRule(rule.id)!;
    expect(updated.opportunities).toBe(1);
    expect(updated.violated).toBe(1);
  });

  it('gets rules for context (global + project + file)', () => {
    db.createRule(makeRule({ id: 'g1', scope: 'global', state: 'active' }));
    db.createRule(makeRule({ id: 'p1', scope: 'project', scopeTarget: '/proj', state: 'active' }));
    db.createRule(makeRule({ id: 'f1', scope: 'file', scopeTarget: '/proj/app.ts', state: 'active' }));
    const rules = db.getActiveRulesForContext('/proj', '/proj/app.ts');
    expect(rules).toHaveLength(3);
  });

  it('finds rules for pruning', () => {
    db.createRule(makeRule({ id: 'r1', state: 'active', opportunities: 15, followed: 2, violated: 13 }));
    db.createRule(makeRule({ id: 'r2', state: 'active', opportunities: 15, followed: 12, violated: 3 }));
    const forPruning = db.getRulesForPruning(10, 0.3);
    expect(forPruning).toHaveLength(1);
    expect(forPruning[0].id).toBe('r1');
  });
});

// ── Patterns CRUD ───────────────────────────────────

describe('LearnerDB - Patterns', () => {
  it('creates and retrieves a pattern', () => {
    const pattern = makePattern();
    db.createPattern(pattern);
    const fetched = db.getPattern(pattern.id);
    expect(fetched).toEqual(pattern);
  });

  it('deletes a pattern', () => {
    const pattern = makePattern();
    db.createPattern(pattern);
    expect(db.deletePattern(pattern.id)).toBe(true);
    expect(db.getPattern(pattern.id)).toBeNull();
  });

  it('filters patterns by type', () => {
    db.createPattern(makePattern({ id: 'p1', type: 'correction' }));
    db.createPattern(makePattern({ id: 'p2', type: 'rollback' }));
    expect(db.getPatterns({ type: 'correction' })).toHaveLength(1);
  });

  it('filters patterns by session', () => {
    db.createPattern(makePattern({ id: 'p1', sessionId: 'sess_a' }));
    db.createPattern(makePattern({ id: 'p2', sessionId: 'sess_b' }));
    expect(db.getPatternsForSession('sess_a')).toHaveLength(1);
  });

  it('counts patterns by type', () => {
    db.createPattern(makePattern({ id: 'p1', type: 'correction' }));
    db.createPattern(makePattern({ id: 'p2', type: 'correction' }));
    db.createPattern(makePattern({ id: 'p3', type: 'retry' }));
    const counts = db.countPatternsByType();
    expect(counts.correction).toBe(2);
    expect(counts.retry).toBe(1);
  });
});

// ── Sessions CRUD ───────────────────────────────────

describe('LearnerDB - Sessions', () => {
  it('creates and retrieves a session', () => {
    const session = makeSession();
    db.createSession(session);
    const fetched = db.getSession(session.id);
    expect(fetched).toEqual(session);
  });

  it('updates a session', () => {
    const session = makeSession();
    db.createSession(session);
    const updated = db.updateSession(session.id, { messageCount: 42 });
    expect(updated?.messageCount).toBe(42);
  });

  it('deletes a session', () => {
    const session = makeSession();
    db.createSession(session);
    expect(db.deleteSession(session.id)).toBe(true);
  });

  it('ends a session', () => {
    const session = makeSession();
    db.createSession(session);
    const ended = db.endSession(session.id);
    expect(ended?.endedAt).toBeDefined();
  });

  it('increments message count', () => {
    const session = makeSession({ messageCount: 5 });
    db.createSession(session);
    db.incrementMessageCount(session.id, 3);
    const updated = db.getSession(session.id);
    expect(updated?.messageCount).toBe(8);
  });

  it('gets active sessions', () => {
    db.createSession(makeSession({ id: 's1' }));
    db.createSession(makeSession({ id: 's2', endedAt: Date.now() }));
    expect(db.getActiveSessions()).toHaveLength(1);
  });

  it('getOrCreateSession creates if not exists', () => {
    const session = db.getOrCreateSession('new_sess', '/project');
    expect(session.id).toBe('new_sess');
    expect(session.projectPath).toBe('/project');
  });

  it('getOrCreateSession returns existing', () => {
    const original = makeSession({ id: 'existing', messageCount: 10 });
    db.createSession(original);
    const result = db.getOrCreateSession('existing', '/project');
    expect(result.messageCount).toBe(10);
  });
});

// ── Statistics ──────────────────────────────────────

describe('LearnerDB - Stats', () => {
  it('returns overall statistics', () => {
    db.createRule(makeRule({ id: 'r1', state: 'active' }));
    db.createRule(makeRule({ id: 'r2', state: 'proposed' }));
    db.createPattern(makePattern({ id: 'p1', type: 'correction' }));
    db.createSession(makeSession({ id: 's1', messageCount: 10 }));

    const stats = db.getStats();
    expect(stats.rules.total).toBe(2);
    expect(stats.rules.active).toBe(1);
    expect(stats.rules.proposed).toBe(1);
    expect(stats.patterns.total).toBe(1);
    expect(stats.sessions.total).toBe(1);
    expect(stats.sessions.totalMessages).toBe(10);
  });
});

// ── Version Info ────────────────────────────────────

describe('LearnerDB - Migrations', () => {
  it('reports version info', () => {
    const info = db.getVersionInfo();
    expect(info.current).toBeGreaterThanOrEqual(1);
    expect(info.latest).toBeGreaterThanOrEqual(1);
  });
});
