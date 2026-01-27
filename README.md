# 🧠 claude-learner

**Your AI that trains itself.** MCP-native self-improving agent for Claude Code.

[![npm version](https://img.shields.io/npm/v/claude-learner.svg)](https://www.npmjs.com/package/claude-learner)
[![GitHub release](https://img.shields.io/github/v/release/unisone/claude-learner)](https://github.com/unisone/claude-learner/releases)
[![CI](https://github.com/unisone/claude-learner/actions/workflows/ci.yml/badge.svg)](https://github.com/unisone/claude-learner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Every correction becomes a rule. Every rule makes Claude smarter. **Automatically.**

---

## ⚡ 30-Second Setup

```bash
npm install -g claude-learner
claude-learner init
```

**That's it.** Claude now learns from every session.

---

## The Problem

You correct Claude. Claude forgets. You correct again.

```
You: "Don't use rm, use trash"
Claude: *uses rm again next session*
You: 🤦
```

Knowledge dies when the session ends.

## The Solution

**claude-learner** watches your sessions, detects patterns, and creates permanent rules:

```
[daemon] Detected: User corrected "rm" → "trash" (3 times)
[daemon] 📋 Proposed rule: "Use trash instead of rm"
[you]    claude-learner approve rule_xxx
[claude] *follows rule forever*
```

---

## How It Works

```
📝 You work with Claude Code
     ↓
👁️  Daemon watches sessions in real-time
     ↓
🔍 Detects patterns (corrections, retries, rollbacks)
     ↓
📋 Proposes rules for your approval
     ↓
✅ Approved rules become permanent
     ↓
🎯 Claude follows them via MCP
     ↓
📊 Ineffective rules get auto-pruned
```

The daemon runs in the background. You don't need to do anything except approve good rules.

---

## Commands

| Command | What it does |
|---------|--------------|
| `init` | One-step setup (starts daemon + registers MCP) |
| `start` | Start the learning daemon |
| `stop` | Stop the daemon |
| `status` | Show daemon status + stats |
| `watch` | Live activity feed |
| `rules` | List all rules |
| `rules --pending` | Show rules awaiting approval |
| `rules --effectiveness` | Show compliance rates |
| `approve <id>` | Approve a proposed rule |
| `reject <id>` | Reject a proposed rule |
| `mcp-serve` | Start MCP server (for Claude Code) |

### v1 commands still work:
| `analyze` | Batch-analyze session history |
| `improve` | Generate CLAUDE.md suggestions |
| `export` | Export learnings to files |
| `stats` | Usage statistics |

---

## MCP Integration

When integrated with Claude Code, these tools are available:

| Tool | Purpose |
|------|---------|
| `get_rules` | Load active rules at session start |
| `check_rule` | Check if action violates a rule |
| `log_correction` | Log corrections for learning |
| `record_compliance` | Track rule effectiveness |
| `get_pending_rules` | View proposed rules |
| `approve_rule` / `reject_rule` | Manage rules |

Claude Code automatically calls these to learn and improve.

---

## Example Workflow

1. **You correct Claude**: "Don't use `any`, use proper types"
2. **Daemon detects it**: Logs as correction pattern
3. **Pattern repeats**: Same correction 2+ times
4. **Rule proposed**: `"Don't use any type"`
5. **You approve**: `claude-learner approve rule_xxx`
6. **Rule active**: Claude checks it before using `any`
7. **Tracked**: System monitors compliance
8. **Auto-prune**: If ignored >70%, rule is pruned

---

## Rule Scopes

| Scope | Applies to | Example |
|-------|-----------|---------|
| `global` | All projects | "Use 2-space indentation" |
| `project` | Specific project | "This repo uses pnpm" |
| `file` | File pattern | "*.test.ts files use vitest" |

---

## Storage

```
~/.claude-learner/
└── learner.db      # SQLite database (rules, patterns, sessions)

/tmp/
├── claude-learner.pid    # Daemon PID
└── claude-learner.log    # Daemon logs
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Claude Code    │────▶│  MCP Server  │────▶│   SQLite    │
│  (your work)    │     │  (7 tools)   │     │  (storage)  │
└─────────────────┘     └──────────────┘     └─────────────┘
         │                                          ▲
         ▼                                          │
┌─────────────────┐     ┌──────────────┐           │
│ Session Files   │────▶│   Daemon     │───────────┘
│ ~/.claude/...   │     │  (watcher)   │
└─────────────────┘     └──────────────┘
```

---

## Requirements

- Node.js 20+
- Claude Code (for MCP integration)

---

## FAQ

**Does it send data anywhere?**  
No. Everything runs locally. Your sessions never leave your machine.

**Can I use it without the daemon?**  
Yes. Use `analyze`/`improve`/`export` for batch processing.

**How do I uninstall?**  
```bash
claude-learner stop
npm uninstall -g claude-learner
rm -rf ~/.claude-learner
```

---

## Support

If this saved you time:

- ☕ [Buy Me a Coffee](https://buymeacoffee.com/unisone)
- 💜 [GitHub Sponsors](https://github.com/sponsors/unisone)
- ⭐ [Star the repo](https://github.com/unisone/claude-learner)

---

## Links

- 📋 [Changelog](CHANGELOG.md)
- 🚀 [Releases](https://github.com/unisone/claude-learner/releases)
- 🐛 [Issues](https://github.com/unisone/claude-learner/issues)
- 💡 [Discussions](https://github.com/unisone/claude-learner/discussions)

---

## License

MIT © [Alex Zaytsev](https://github.com/unisone)

---

**Make Claude Code actually learn.** Install in 30 seconds. Never repeat a correction.
