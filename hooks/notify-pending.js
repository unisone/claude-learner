#!/usr/bin/env node
/**
 * Stop hook — Notifies about pending rules when Claude finishes a turn
 *
 * Only outputs if there are pending rules awaiting approval.
 * Runs quickly and silently fails if anything goes wrong.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

function main() {
  try {
    const dbPath = join(process.env.HOME || '~', '.claude-learner', 'learner.db');
    if (!existsSync(dbPath)) return;

    const output = execFileSync('sqlite3', [
      dbPath,
      "SELECT COUNT(*) FROM rules WHERE state='proposed';"
    ], { encoding: 'utf-8', timeout: 2000 });

    const pending = parseInt(output.trim()) || 0;
    if (pending > 0) {
      console.log(`[claude-learner] ${pending} rule(s) awaiting your approval. Run: claude-learner rules --pending`);
    }
  } catch {
    // Silently fail — never block Claude
  }
}

main();
