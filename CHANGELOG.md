# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-02-16

### Added
- **Test Suite** — 108 tests across 5 test files using Vitest
  - Analyzer pattern detection (corrections, false-positive filtering, aggregation)
  - Rule engine lifecycle (state machine, auto-prune, compliance tracking)
  - SQLite storage CRUD (rules, patterns, sessions, statistics)
  - Type utilities (compliance rates, ID generators, row converters)
  - Utility functions (text extraction, formatting, truncation)
- **CLAUDE.md Sync** — Write active rules directly into CLAUDE.md files
  - `sync` CLI command with `--global`, `--project`, `--target` options
  - `sync_to_claude_md` MCP tool (8th tool, now 8 total)
  - Managed `<!-- claude-learner:start -->` / `<!-- claude-learner:end -->` comment markers
  - Supports project-level and global CLAUDE.md
- **Enhanced Local Analysis** — Smarter rule extraction without OpenAI
  - Auto-categorizes rules (coding-style, testing, git, architecture, tooling)
  - Handles "use X instead of Y" patterns, "I meant X" corrections
  - Extracts rules from all high-confidence patterns (not just frequency > 1)
- **CI Test Pipeline** — Tests run on every push and PR before build

### Changed
- OpenAI moved from required to optional dependency (dynamic import)
  - Local analysis works without `openai` package installed
  - Reduces install size for users who don't need AI-enhanced suggestions
- CI pipeline now has 3 stages: security-scan → test → build
- `npm test` now runs Vitest (was `echo "No tests yet"`)

## [2.1.0] - 2026-02-16

### Added
- **Native Hooks** — Real-time correction detection via Claude Code hooks system
  - `UserPromptSubmit` hook detects corrections as you type ("don't do X", "use Y instead")
  - `Stop` hook reminds about pending rules awaiting approval
  - No daemon required — hooks run automatically via the plugin
- **Security Scanning CI** — Automated secret/PII detection on every push and PR
  - Scans for API keys (OpenAI, Slack, GitHub, AWS, Anthropic)
  - Blocks private filesystem paths and internal IPs
  - Runs before build step — fails fast

### Fixed
- **CRITICAL: MCP tools now return actual data** — All 7 tool handlers were missing `await`, causing every MCP call to return `{}` instead of rule data (fixes #2)
- **Command injection risk** — `execSync` in daemon process manager replaced with `execFileSync` to prevent shell interpolation
- **RegExp safety** — Rule engine now catches invalid regex in scope targets instead of crashing
- **Private path leak** — Removed `/Users/danbot/` paths from generated asset HTML files

### Changed
- CI matrix simplified to Node.js 20.x and 22.x (dropped 18.x, which is EOL)
- CI now includes `npm audit` step for dependency vulnerability checking
- Updated cross-references: `moltbot-config` → `openclaw-config`
- Plugin manifest includes `hooks` directory

### Security
- Added CI scanning for 7+ secret types, private paths, and internal IPs
- Fixed potential ReDoS in rule scope matching
- Replaced shell interpolation with safe argument passing

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

[2.2.0]: https://github.com/unisone/claude-learner/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/unisone/claude-learner/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/unisone/claude-learner/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/unisone/claude-learner/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/unisone/claude-learner/releases/tag/v1.0.0
