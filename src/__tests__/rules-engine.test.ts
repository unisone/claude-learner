import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine } from '../rules/engine.js';
import type { Rule, Pattern } from '../types.js';

// ── Helpers ─────────────────────────────────────────

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule_1',
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

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'pat_1',
    sessionId: 'sess_1',
    type: 'correction',
    content: 'test correction',
    context: 'test context',
    detectedAt: Date.now(),
    ...overrides,
  };
}

// ── Core lifecycle ──────────────────────────────────

describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  describe('loadRules', () => {
    it('loads rules into the engine', () => {
      engine.loadRules([makeRule(), makeRule({ id: 'rule_2', text: 'Always run tests' })]);
      expect(engine.getAllRules()).toHaveLength(2);
    });

    it('clears previous rules on reload', () => {
      engine.loadRules([makeRule()]);
      engine.loadRules([makeRule({ id: 'rule_new' })]);
      expect(engine.getAllRules()).toHaveLength(1);
      expect(engine.getAllRules()[0].id).toBe('rule_new');
    });
  });

  describe('getRulesByState', () => {
    it('filters by state', () => {
      engine.loadRules([
        makeRule({ id: 'r1', state: 'active' }),
        makeRule({ id: 'r2', state: 'proposed' }),
        makeRule({ id: 'r3', state: 'pruned' }),
      ]);
      expect(engine.getRulesByState('active')).toHaveLength(1);
      expect(engine.getRulesByState('proposed')).toHaveLength(1);
      expect(engine.getRulesByState('pruned')).toHaveLength(1);
    });
  });

  // ── Active rules with scope filtering ───────────

  describe('getActiveRules', () => {
    beforeEach(() => {
      engine.loadRules([
        makeRule({ id: 'global_1', scope: 'global', state: 'active' }),
        makeRule({ id: 'project_1', scope: 'project', scopeTarget: '/my/project', state: 'active' }),
        makeRule({ id: 'file_1', scope: 'file', scopeTarget: '.test.ts', state: 'active' }),
        makeRule({ id: 'proposed_1', scope: 'global', state: 'proposed' }),
      ]);
    });

    it('returns global rules without context', () => {
      const rules = engine.getActiveRules();
      expect(rules.map(r => r.id)).toContain('global_1');
      expect(rules.map(r => r.id)).not.toContain('proposed_1');
    });

    it('returns project rules when project matches', () => {
      const rules = engine.getActiveRules({ project: '/my/project' });
      expect(rules.map(r => r.id)).toContain('project_1');
    });

    it('excludes project rules when project does not match', () => {
      const rules = engine.getActiveRules({ project: '/other/project' });
      expect(rules.map(r => r.id)).not.toContain('project_1');
    });

    it('returns file rules when file matches (substring)', () => {
      const rules = engine.getActiveRules({ file: 'src/foo.test.ts' });
      expect(rules.map(r => r.id)).toContain('file_1');
    });

    it('returns file rules when file matches (regex)', () => {
      engine.loadRules([
        makeRule({ id: 'regex_rule', scope: 'file', scopeTarget: '\\.tsx?$', state: 'active' }),
      ]);
      const rules = engine.getActiveRules({ file: 'src/component.tsx' });
      expect(rules.map(r => r.id)).toContain('regex_rule');
    });

    it('handles invalid regex in scopeTarget gracefully', () => {
      engine.loadRules([
        makeRule({ id: 'bad_regex', scope: 'file', scopeTarget: '[invalid(', state: 'active' }),
      ]);
      // Should not throw
      const rules = engine.getActiveRules({ file: '[invalid(' });
      expect(rules.map(r => r.id)).toContain('bad_regex');
    });
  });

  // ── State machine transitions ─────────────────

  describe('proposeRule', () => {
    it('creates a rule in proposed state', () => {
      const pattern = makePattern();
      const rule = engine.proposeRule('Never use any type', 'global', pattern);
      expect(rule.state).toBe('proposed');
      expect(rule.id).toMatch(/^rule_/);
      expect(engine.getAllRules()).toHaveLength(1);
    });
  });

  describe('approveRule', () => {
    it('transitions proposed → active', () => {
      const pattern = makePattern();
      const rule = engine.proposeRule('Use strict mode', 'global', pattern);
      const approved = engine.approveRule(rule.id);
      expect(approved?.state).toBe('active');
    });

    it('returns null for non-proposed rules', () => {
      engine.loadRules([makeRule({ id: 'active_rule', state: 'active' })]);
      expect(engine.approveRule('active_rule')).toBeNull();
    });

    it('returns null for non-existent rules', () => {
      expect(engine.approveRule('nonexistent')).toBeNull();
    });
  });

  describe('rejectRule', () => {
    it('transitions proposed → rejected', () => {
      const pattern = makePattern();
      const rule = engine.proposeRule('Bad rule', 'global', pattern);
      const rejected = engine.rejectRule(rule.id);
      expect(rejected?.state).toBe('rejected');
    });
  });

  describe('pruneRule', () => {
    it('transitions active → pruned', () => {
      engine.loadRules([makeRule({ id: 'r1', state: 'active' })]);
      const pruned = engine.pruneRule('r1');
      expect(pruned?.state).toBe('pruned');
    });

    it('returns null for non-active rules', () => {
      engine.loadRules([makeRule({ id: 'r1', state: 'proposed' })]);
      expect(engine.pruneRule('r1')).toBeNull();
    });
  });

  // ── Compliance tracking ───────────────────────

  describe('recordFollowed / recordViolated', () => {
    it('increments followed count', () => {
      engine.loadRules([makeRule({ id: 'r1', state: 'active' })]);
      engine.recordFollowed('r1');
      engine.recordFollowed('r1');
      const rule = engine.getAllRules()[0];
      expect(rule.followed).toBe(2);
      expect(rule.opportunities).toBe(2);
    });

    it('increments violated count', () => {
      engine.loadRules([makeRule({ id: 'r1', state: 'active' })]);
      engine.recordViolated('r1');
      const rule = engine.getAllRules()[0];
      expect(rule.violated).toBe(1);
      expect(rule.opportunities).toBe(1);
    });

    it('ignores non-active rules', () => {
      engine.loadRules([makeRule({ id: 'r1', state: 'proposed' })]);
      engine.recordFollowed('r1');
      expect(engine.getAllRules()[0].followed).toBe(0);
    });
  });

  // ── Auto-prune ────────────────────────────────

  describe('auto-prune', () => {
    it('prunes rule below threshold after min opportunities', () => {
      engine = new RuleEngine({ minOpportunitiesForPrune: 5, pruneThreshold: 0.3 });
      engine.loadRules([makeRule({ id: 'r1', state: 'active' })]);

      // Violate 5 times (0% compliance after 5 opp)
      for (let i = 0; i < 5; i++) {
        engine.recordViolated('r1');
      }
      expect(engine.getAllRules()[0].state).toBe('pruned');
    });

    it('does not prune if compliance is above threshold', () => {
      engine = new RuleEngine({ minOpportunitiesForPrune: 5, pruneThreshold: 0.3 });
      engine.loadRules([makeRule({ id: 'r1', state: 'active' })]);

      // 3 followed, 2 violated = 60% compliance
      engine.recordFollowed('r1');
      engine.recordFollowed('r1');
      engine.recordFollowed('r1');
      engine.recordViolated('r1');
      engine.recordViolated('r1');
      expect(engine.getAllRules()[0].state).toBe('active');
    });

    it('respects autoPruneEnabled = false', () => {
      engine = new RuleEngine({ autoPruneEnabled: false, minOpportunitiesForPrune: 2, pruneThreshold: 0.5 });
      engine.loadRules([makeRule({ id: 'r1', state: 'active' })]);

      engine.recordViolated('r1');
      engine.recordViolated('r1');
      engine.recordViolated('r1');
      expect(engine.getAllRules()[0].state).toBe('active');
    });
  });

  // ── Action checking ───────────────────────────

  describe('checkAction', () => {
    it('detects prohibited actions (don\'t)', () => {
      // checkAction extracts prohibited text after negation words, then does substring match
      // "Don't use rm" → prohibited = "use rm"
      engine.loadRules([makeRule({ id: 'r1', text: "Don't use rm", state: 'active' })]);
      const result = engine.checkAction('I will use rm to delete files');
      expect(result.allowed).toBe(false);
      expect(result.violatedRule?.id).toBe('r1');
    });

    it('allows non-violating actions', () => {
      engine.loadRules([makeRule({ id: 'r1', text: "Don't use rm", state: 'active' })]);
      const result = engine.checkAction('using trash to delete files');
      expect(result.allowed).toBe(true);
    });

    it('ignores proposed/pruned rules', () => {
      engine.loadRules([makeRule({ id: 'r1', text: "Don't use rm", state: 'proposed' })]);
      const result = engine.checkAction('using rm');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Reports ───────────────────────────────────

  describe('getRulesNeedingAttention', () => {
    it('returns proposed rules', () => {
      engine.loadRules([
        makeRule({ id: 'r1', state: 'proposed' }),
        makeRule({ id: 'r2', state: 'active' }),
      ]);
      const attention = engine.getRulesNeedingAttention();
      expect(attention.proposed).toHaveLength(1);
    });

    it('returns low-compliance active rules', () => {
      engine.loadRules([
        makeRule({ id: 'r1', state: 'active', opportunities: 10, followed: 3, violated: 7 }),
      ]);
      const attention = engine.getRulesNeedingAttention();
      expect(attention.lowCompliance).toHaveLength(1);
    });
  });

  describe('getEffectivenessReport', () => {
    it('categorizes rules by compliance rate', () => {
      engine.loadRules([
        makeRule({ id: 'high', state: 'active', opportunities: 10, followed: 9, violated: 1 }),
        makeRule({ id: 'med', state: 'active', opportunities: 10, followed: 6, violated: 4 }),
        makeRule({ id: 'low', state: 'active', opportunities: 10, followed: 4, violated: 6 }),
        makeRule({ id: 'ignored', state: 'active', opportunities: 10, followed: 1, violated: 9 }),
      ]);
      const report = engine.getEffectivenessReport();
      expect(report.high).toHaveLength(1);
      expect(report.medium).toHaveLength(1);
      expect(report.low).toHaveLength(1);
      expect(report.ignored).toHaveLength(1);
    });
  });
});
