# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-01-27

### Added
- **MCP Server** — Native Claude Code integration via Model Context Protocol
  - 7 tools: `get_rules`, `check_rule`, `log_correction`, `record_compliance`, `get_pending_rules`, `approve_rule`, `reject_rule`
- **Real-time Daemon** — Watches `~/.claude/projects/` for session changes
  - Pattern detection (corrections, retries, rollbacks)
  - Snapshot save/restore between restarts
- **SQLite Storage** — Persistent rules, patterns, and session tracking
  - Schema migrations with version tracking
  - Effectiveness metrics (opportunities/followed/violated)
- **Rule Engine** — Full lifecycle management
  - State machine: proposed → active → pruned
  - Auto-prune ineffective rules (<30% compliance after 10+ opportunities)
  - Scoped rules: global, project, file
- **New Commands**
  - `init` — One-step setup (creates DB, starts daemon, registers MCP)
  - `start` / `stop` — Daemon control
  - `status` — Show daemon status + stats
  - `watch` — Live activity feed
  - `rules` — List and manage rules
  - `approve <id>` / `reject <id>` — Rule approval workflow
  - `mcp-serve` — Start MCP server for Claude Code

### Changed
- Minimum Node.js version: 20.0.0 (was 18.0.0)
- Tagline: "Your AI that trains itself"

### Deprecated
- v1 commands (`analyze`, `improve`, `export`, `stats`) still work but are superseded by the daemon-based approach

## [1.1.0] - 2026-01-27

### Added
- `stats` command — Show Claude Code usage statistics
- Context-aware pattern scoping (project/file level)

### Fixed
- GitHub links in exports (was placeholder, now correct)

## [1.0.0] - 2026-01-26

### Added
- Initial release
- `analyze` command — Analyze Claude Code sessions for patterns
- `improve` command — Generate CLAUDE.md improvements via OpenAI
- `export` command — Export learnings to `.learnings/` directory
- Pattern detection: corrections, rollbacks, retries, failed commands
- Support for Buy Me a Coffee, GitHub Sponsors, Ko-fi

[2.0.0]: https://github.com/unisone/claude-learner/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/unisone/claude-learner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/unisone/claude-learner/releases/tag/v1.0.0
