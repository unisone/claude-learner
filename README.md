# 🧠 claude-learner

**Your AI that trains itself.** MCP-native self-improving agent for Claude Code.

[![npm version](https://img.shields.io/npm/v/claude-learner.svg)](https://www.npmjs.com/package/claude-learner)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Every mistake becomes a rule. Every correction becomes a lesson. **Automatically.**

## Before/After

```
❌ Without claude-learner:
   Claude keeps making the same mistakes
   You correct the same things every session
   Knowledge dies when the session ends

✅ With claude-learner:
   Corrections become permanent rules
   Claude gets smarter every session
   Your preferences persist forever
```

## 🚀 Quick Start

```bash
# Install globally
npm install -g claude-learner

# Start the daemon (watches your sessions, proposes rules)
claude-learner start

# Add MCP server to Claude Code
claude mcp add claude-learner -- node $(which claude-learner | xargs dirname)/claude-learner mcp-serve
```

**That's it.** Claude now learns from every session.

## How It Works

```
📝 You work with Claude Code
     ↓
👁️  Daemon watches your sessions in real-time
     ↓
🔍 AI detects patterns (corrections, rollbacks, retries)
     ↓
📋 Proposes rules for your approval
     ↓
✅ Approved rules become permanent
     ↓
🎯 Claude follows them in future sessions
     ↓
📊 Ineffective rules get auto-pruned
```

## ✨ Features

### 🔄 Real-Time Learning
- Watches `~/.claude/projects/` for session changes
- Detects corrections, rollbacks, and retries
- Proposes rules from patterns

### 📋 Smart Rule Management
```bash
# List all active rules
claude-learner rules

# Show pending approvals
claude-learner rules --pending

# View effectiveness report
claude-learner rules --effectiveness

# Approve/reject rules
claude-learner approve <rule-id>
claude-learner reject <rule-id>
```

### 🎯 MCP Integration
When integrated with Claude Code, the AI can:
- Query active rules at session start
- Check if actions violate rules
- Log corrections for pattern detection
- Request rule approval

### 📊 Effectiveness Tracking
- Tracks compliance rate for each rule
- Auto-prunes rules that get ignored
- Shows which rules actually work

## Commands

| Command | Description |
|---------|-------------|
| `start [--foreground]` | Start the learning daemon |
| `stop` | Stop the daemon |
| `daemon-status` | Show daemon status |
| `rules [--pending\|--effectiveness]` | List and manage rules |
| `approve <id>` | Approve a pending rule |
| `reject <id>` | Reject a pending rule |
| `mcp-serve` | Start MCP server (stdio) |
| `analyze` | Analyze sessions for patterns |
| `improve` | Generate CLAUDE.md improvements |
| `export` | Export learnings to files |
| `stats` | Show usage statistics |

## MCP Tools

When connected via MCP, Claude Code gets these tools:

| Tool | Description |
|------|-------------|
| `get_rules` | Get active rules for context |
| `check_rule` | Check if action violates rules |
| `log_correction` | Log a user correction |
| `get_pending_rules` | Get rules awaiting approval |
| `approve_rule` | Approve a proposed rule |
| `reject_rule` | Reject a proposed rule |

## Configuration

Rules are stored in `~/.claude-learner/learner.db` (SQLite).

Each rule has:
- **Scope**: `global`, `project`, or `file`
- **State**: `proposed` → `active` → `pruned`
- **Effectiveness**: tracked via opportunities/followed/violated

## Example Workflow

1. **Correction detected**: You tell Claude "don't use `rm`, use `trash` instead"
2. **Pattern logged**: System records this correction
3. **Rule proposed**: "Use `trash` instead of `rm` for file deletion"
4. **You approve**: `claude-learner approve rule_xxx`
5. **Rule active**: Next session, Claude follows the rule
6. **Tracked**: System monitors if Claude follows it
7. **Auto-prune**: If Claude keeps ignoring it, rule gets pruned

## v1 → v2 Migration

v2 is a complete rewrite with:
- **MCP-native** integration (replaces manual CLAUDE.md)
- **Real-time** daemon (replaces batch analysis)
- **SQLite storage** (replaces flat files)
- **Effectiveness tracking** (replaces static rules)

v1 commands (`analyze`, `improve`, `export`, `stats`) still work.

## Support

If this tool saved you time, consider supporting development:

- ☕ [Buy Me a Coffee](https://buymeacoffee.com/unisone)
- 💜 [GitHub Sponsors](https://github.com/sponsors/unisone)
- ⭐ [Star the repo](https://github.com/unisone/claude-learner)

## License

MIT © [Alex Zaytsev](https://github.com/unisone)

---

**Make Claude Code actually learn.** Install in 30 seconds.
