#!/usr/bin/env node
/**
 * UserPromptSubmit hook — Detects correction patterns in real-time
 *
 * Receives JSON on stdin: { "prompt": "user message text", ... }
 * Stdout is injected into Claude's context as system information.
 *
 * When a correction is detected, logs it to the SQLite database
 * and outputs active rules relevant to the current project.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

// High-confidence correction patterns (from src/analyzer.ts)
const CORRECTION_PATTERNS = [
  /\bthat'?s\s+(not\s+)?(wrong|incorrect)\b/i,
  /\bno[,.]?\s+(that'?s\s+)?(not|wrong|incorrect)\b/i,
  /\bdon'?t\s+do\s+that\b/i,
  /\bstop[!.]?\s/i,
  /\bundo\s+(that|this|it)\b/i,
  /\brevert\s+(that|this|it|the|to)\b/i,
  /\bI\s+(already\s+)?(said|told\s+you|mentioned)\b/i,
  /\bI\s+meant\b/i,
  /\bchange\s+it\s+back\b/i,
  /\bnot\s+what\s+I\s+(asked|wanted|meant)\b/i,
  /\bI\s+didn'?t\s+(ask|want|mean)\b/i,
  /\bwhy\s+did\s+you\b.*\?/i,
  /\bthat\s+broke\b/i,
  /\byou\s+(just\s+)?broke\b/i,
];

// Rule extraction patterns
const RULE_PATTERNS = [
  { regex: /don'?t\s+(.+?)(?:\.|,|!|$)/i, template: (m) => `Don't ${m[1]}` },
  { regex: /use\s+(.+?)\s+instead/i, template: (m) => `Use ${m[1]}` },
  { regex: /always\s+(.+?)(?:\.|,|!|$)/i, template: (m) => `Always ${m[1]}` },
  { regex: /never\s+(.+?)(?:\.|,|!|$)/i, template: (m) => `Never ${m[1]}` },
  { regex: /prefer\s+(.+?)(?:\.|,|!|$)/i, template: (m) => `Prefer ${m[1]}` },
];

function main() {
  try {
    // Read stdin (hook payload)
    const input = readFileSync(0, 'utf-8');
    if (!input.trim()) return;

    const payload = JSON.parse(input);
    const prompt = payload.prompt || '';

    if (!prompt || prompt.length < 10) return;

    // Check for correction patterns
    const isCorrection = CORRECTION_PATTERNS.some(p => p.test(prompt));

    if (isCorrection) {
      // Try to extract a rule
      let ruleText = null;
      for (const { regex, template } of RULE_PATTERNS) {
        const match = prompt.match(regex);
        if (match) {
          ruleText = template(match);
          break;
        }
      }

      // Log to database via CLI (non-blocking)
      const dbPath = join(process.env.HOME || '~', '.claude-learner', 'learner.db');
      if (existsSync(dbPath)) {
        // We log to stderr so it doesn't get injected into Claude's context
        const project = process.env.CLAUDE_PROJECT_DIR || 'unknown';
        console.error(`[claude-learner] Correction detected: "${prompt.slice(0, 80)}..."`);
        if (ruleText) {
          console.error(`[claude-learner] Potential rule: "${ruleText}"`);
        }
      }

      // Output context for Claude (stdout = injected into Claude's context)
      if (ruleText) {
        console.log(`[claude-learner] Correction detected. Potential new rule: "${ruleText}". Use the log_correction MCP tool to record this.`);
      }
    }

    // Load and output active rules (runs on every prompt, lightweight)
    const dbPath = join(process.env.HOME || '~', '.claude-learner', 'learner.db');
    if (existsSync(dbPath)) {
      try {
        // Quick check: read rules count from DB via a lightweight approach
        // Full rule loading happens via MCP tools - this is just a reminder
        const stats = getQuickStats(dbPath);
        if (stats.pending > 0) {
          console.log(`[claude-learner] ${stats.pending} rule(s) pending approval. Use get_pending_rules to review.`);
        }
      } catch {
        // Silently fail — don't block the user
      }
    }
  } catch (err) {
    // Never block the user prompt — fail silently
    console.error(`[claude-learner hook error] ${err.message || err}`);
  }
}

function getQuickStats(dbPath) {
  // Use sqlite3 CLI for a quick query (avoids loading better-sqlite3 native module)
  try {
    const output = execFileSync('sqlite3', [
      dbPath,
      "SELECT COUNT(*) FROM rules WHERE state='proposed';"
    ], { encoding: 'utf-8', timeout: 2000 });
    return { pending: parseInt(output.trim()) || 0 };
  } catch {
    return { pending: 0 };
  }
}

main();
