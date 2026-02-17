/**
 * CLAUDE.md Sync — writes active rules into CLAUDE.md with comment markers
 *
 * Managed section uses HTML comments so they're invisible in rendered markdown:
 *   <!-- claude-learner:start -->
 *   ...rules...
 *   <!-- claude-learner:end -->
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { getDB } from './storage/db.js';
import { getComplianceRate } from './types.js';
import type { Rule } from './types.js';

const START_MARKER = '<!-- claude-learner:start -->';
const END_MARKER = '<!-- claude-learner:end -->';

export interface SyncOptions {
  /** Path to target CLAUDE.md (auto-detected if omitted) */
  target?: string;
  /** Only sync global rules */
  global?: boolean;
  /** Project path for project-scoped rules */
  project?: string;
  /** Dry run — print what would be written */
  dryRun?: boolean;
}

export interface SyncResult {
  path: string;
  rulesWritten: number;
  created: boolean;
  dryRun: boolean;
}

/**
 * Resolve the CLAUDE.md path to write to
 */
function resolveTarget(options: SyncOptions): string {
  if (options.target) return options.target;

  if (options.global) {
    // Global rules → ~/.claude/CLAUDE.md
    return join(homedir(), '.claude', 'CLAUDE.md');
  }

  // Project-level → ./CLAUDE.md in CWD
  return join(process.cwd(), 'CLAUDE.md');
}

/**
 * Format rules into a markdown section
 */
function formatRulesSection(rules: Rule[]): string {
  if (rules.length === 0) {
    return [
      START_MARKER,
      '## Learned Rules',
      '',
      '_No active rules yet. Use `claude-learner` to learn from your sessions._',
      END_MARKER,
    ].join('\n');
  }

  const lines: string[] = [START_MARKER, '## Learned Rules', ''];

  // Group by scope
  const global = rules.filter(r => r.scope === 'global');
  const project = rules.filter(r => r.scope === 'project');
  const file = rules.filter(r => r.scope === 'file');

  if (global.length > 0) {
    for (const r of global) {
      const rate = Math.round(getComplianceRate(r) * 100);
      lines.push(`- ${r.text}${r.opportunities > 0 ? ` _(${rate}% compliance)_` : ''}`);
    }
    lines.push('');
  }

  if (project.length > 0) {
    lines.push('### Project-specific');
    lines.push('');
    for (const r of project) {
      const rate = Math.round(getComplianceRate(r) * 100);
      lines.push(`- ${r.text}${r.opportunities > 0 ? ` _(${rate}% compliance)_` : ''}`);
    }
    lines.push('');
  }

  if (file.length > 0) {
    lines.push('### File-specific');
    lines.push('');
    for (const r of file) {
      const rate = Math.round(getComplianceRate(r) * 100);
      const target = r.scopeTarget ? ` \`${r.scopeTarget}\`` : '';
      lines.push(`- ${r.text}${target}${r.opportunities > 0 ? ` _(${rate}% compliance)_` : ''}`);
    }
    lines.push('');
  }

  lines.push(END_MARKER);
  return lines.join('\n');
}

/**
 * Sync active rules into a CLAUDE.md file
 */
export function syncRules(options: SyncOptions = {}): SyncResult {
  const db = getDB();
  const targetPath = resolveTarget(options);

  // Fetch relevant rules
  let rules: Rule[];
  if (options.global) {
    rules = db.getRules({ state: 'active', scope: 'global' });
  } else if (options.project) {
    rules = db.getActiveRulesForContext(options.project);
  } else {
    rules = db.getRules({ state: 'active' });
  }

  const section = formatRulesSection(rules);
  let created = false;

  if (options.dryRun) {
    return { path: targetPath, rulesWritten: rules.length, created: false, dryRun: true };
  }

  if (existsSync(targetPath)) {
    // Read existing content
    const existing = readFileSync(targetPath, 'utf-8');

    if (existing.includes(START_MARKER) && existing.includes(END_MARKER)) {
      // Replace existing managed section
      const before = existing.substring(0, existing.indexOf(START_MARKER));
      const after = existing.substring(existing.indexOf(END_MARKER) + END_MARKER.length);
      writeFileSync(targetPath, before + section + after);
    } else {
      // Append managed section
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      writeFileSync(targetPath, existing + separator + section + '\n');
    }
  } else {
    // Create new file with managed section
    const header = `# CLAUDE.md\n\n`;
    writeFileSync(targetPath, header + section + '\n');
    created = true;
  }

  return { path: targetPath, rulesWritten: rules.length, created, dryRun: false };
}

/**
 * Format sync result for CLI output
 */
export function formatSyncResult(result: SyncResult): string {
  const lines: string[] = [];

  if (result.dryRun) {
    lines.push(chalk.yellow('DRY RUN — no files written'));
    lines.push('');
  }

  if (result.created) {
    lines.push(chalk.green(`Created ${result.path}`));
  } else {
    lines.push(chalk.green(`Updated ${result.path}`));
  }

  lines.push(`${result.rulesWritten} active rule${result.rulesWritten !== 1 ? 's' : ''} synced`);

  return lines.join('\n');
}
