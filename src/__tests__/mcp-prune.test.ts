import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDB, closeDB } from '../storage/db.js';
import { handlePruneRules } from '../mcp/tools.js';
import type { Rule } from '../storage/types.js';

// ── Setup / Teardown ──────────────────────────────────

let tmpDir: string;

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: `rule_${Math.random().toString(36).slice(2, 8)}`,
    text: 'Test rule',
    scope: 'global',
    state: 'active',
    createdAt: 1000,
    lastSeenAt: 2000,
    sourcePatterns: [],
    opportunities: 0,
    followed: 0,
    violated: 0,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cl-prune-test-'));
  // Point the shared DB handle at a temp database
  getDB(join(tmpDir, 'test.db'));
});

afterEach(() => {
  closeDB();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────

describe('handlePruneRules', () => {
  it('dry-run lists low-compliance candidates without pruning', async () => {
    const db = getDB();
    // Low compliance: 2 followed / 10 opportunities = 0.2 < 0.3
    db.createRule(makeRule({ opportunities: 10, followed: 2, violated: 8 }));
    // Healthy rule: 9/10 = 0.9
    db.createRule(makeRule({ opportunities: 10, followed: 9, violated: 1 }));

    const result = await handlePruneRules({});

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].complianceRate).toBeCloseTo(0.2);
    expect(result.pruned).toHaveLength(0);
    // Nothing pruned: both still active
    expect(db.getRules({ state: 'active' })).toHaveLength(2);
  });

  it('dryRun: false actually prunes candidates', async () => {
    const db = getDB();
    const bad = db.createRule(makeRule({ opportunities: 10, followed: 2, violated: 8 }));
    const good = db.createRule(makeRule({ opportunities: 10, followed: 9, violated: 1 }));

    const result = await handlePruneRules({ dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.pruned).toEqual([bad.id]);
    expect(db.getRule(bad.id)?.state).toBe('pruned');
    expect(db.getRule(good.id)?.state).toBe('active');
  });

  it('explicit ruleIds prune only those rules', async () => {
    const db = getDB();
    const target = db.createRule(makeRule({ opportunities: 10, followed: 9, violated: 1 }));
    const other = db.createRule(makeRule({ opportunities: 10, followed: 9, violated: 1 }));

    const result = await handlePruneRules({ ruleIds: [target.id], dryRun: false });

    expect(result.pruned).toEqual([target.id]);
    expect(db.getRule(other.id)?.state).toBe('active');
  });

  it('ignores unknown or non-active rule IDs', async () => {
    const result = await handlePruneRules({ ruleIds: ['nope'], dryRun: false });
    expect(result.candidates).toHaveLength(0);
    expect(result.pruned).toHaveLength(0);
  });
});
