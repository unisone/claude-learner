# claude-learner v2.0 — MCP-Native Self-Improving Agent

> **"Your AI that trains itself."**

## Vision

claude-learner v2 transforms from a CLI tool you run into a **living system** that:
- Watches your sessions in real-time
- Proposes rules based on your corrections
- Integrates directly into Claude Code via MCP
- Prunes ineffective rules automatically

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     claude-learner v2                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │   Watcher   │───▶│  Analyzer   │───▶│   Rule Engine       │ │
│  │ (@parcel)   │    │  (patterns) │    │ (propose/track/prune)│ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│         │                                        │              │
│         │           ┌─────────────┐              │              │
│         └──────────▶│   Storage   │◀─────────────┘              │
│                     │  (SQLite)   │                             │
│                     └─────────────┘                             │
│                            │                                    │
│                     ┌──────┴──────┐                             │
│                     ▼             ▼                             │
│              ┌───────────┐ ┌───────────┐                        │
│              │ MCP Server│ │    CLI    │                        │
│              │ (tools)   │ │ (commands)│                        │
│              └───────────┘ └───────────┘                        │
│                     │                                           │
└─────────────────────│───────────────────────────────────────────┘
                      │
                      ▼ MCP Protocol
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code                                │
│  "What rules should I follow for this project?"                 │
│  "I'm about to use 'any' — is that allowed?"                    │
│  "Log this correction for learning"                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Watcher (Real-time Session Monitor)

**Tech:** `@parcel/watcher`

**Why:** 
- Native C++ performance (used by VS Code)
- Historical queries (catch events after restart)
- Zero CPU when idle

**Watches:**
```
~/.claude/projects/*/         # All project sessions
~/.claude/projects/*/*.jsonl  # Session files
```

**Events:**
- `session.created` — New session started
- `session.updated` — Messages added
- `session.ended` — Session completed (inferred from inactivity)

---

### 2. Analyzer (Pattern Detection)

**Reuses:** Existing v1 analyzer with enhancements

**Patterns Detected:**
| Pattern | Confidence | Example |
|---------|------------|---------|
| Explicit correction | High | "No, that's wrong" |
| Undo/revert | High | "Undo that change" |
| Repeated ask | Medium | Same question 3x |
| Failed command | High | Error in output |
| Style correction | Medium | "Use 2 spaces not 4" |

**New in v2:**
- Real-time analysis (on each session update)
- Context extraction (project, file, line)
- Frequency tracking (same pattern across sessions)

---

### 3. Rule Engine (Propose → Track → Prune)

**States:**
```
┌──────────┐    approve    ┌──────────┐
│ PROPOSED │──────────────▶│  ACTIVE  │
└──────────┘               └──────────┘
     │                          │
     │ reject                   │ low compliance
     ▼                          ▼
┌──────────┐               ┌──────────┐
│ REJECTED │               │  PRUNED  │
└──────────┘               └──────────┘
```

**Rule Schema:**
```typescript
interface Rule {
  id: string;
  text: string;                    // "Use 2-space indentation"
  scope: 'global' | 'project' | 'file';
  scopeTarget?: string;            // Project path or file pattern
  state: 'proposed' | 'active' | 'rejected' | 'pruned';
  
  // Tracking
  createdAt: Date;
  lastSeenAt: Date;
  sourcePatterns: string[];        // Pattern IDs that created this
  
  // Effectiveness
  opportunities: number;           // Times rule was relevant
  followed: number;                // Times Claude followed it
  violated: number;                // Times Claude broke it
  complianceRate: number;          // followed / opportunities
}
```

**Auto-Prune Logic:**
```typescript
if (rule.opportunities >= 10 && rule.complianceRate < 0.3) {
  rule.state = 'pruned';
  notify("Rule pruned due to low compliance");
}
```

---

### 4. Storage (SQLite)

**Why SQLite:**
- Zero setup, single file
- Fast queries for rule lookup
- Portable, backed up easily

**Location:** `~/.claude-learner/learner.db`

**Tables:**
```sql
-- Rules
CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_target TEXT,
  state TEXT NOT NULL,
  created_at INTEGER,
  last_seen_at INTEGER,
  opportunities INTEGER DEFAULT 0,
  followed INTEGER DEFAULT 0,
  violated INTEGER DEFAULT 0
);

-- Patterns (raw detections)
CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  type TEXT,
  content TEXT,
  context TEXT,
  detected_at INTEGER
);

-- Sessions (metadata)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  message_count INTEGER
);
```

---

### 5. MCP Server (Claude Code Integration)

**Transport:** stdio (local) or HTTP (remote)

**Tools Exposed:**

#### `get_rules`
```typescript
{
  name: "get_rules",
  description: "Get active rules for current context",
  input: {
    project?: string,    // Filter by project
    file?: string,       // Filter by file
    scope?: string       // 'global' | 'project' | 'file'
  },
  output: {
    rules: Rule[]
  }
}
```

**Claude uses this at session start to load relevant rules.**

#### `check_rule`
```typescript
{
  name: "check_rule",
  description: "Check if an action would violate a rule",
  input: {
    action: string,      // "Using 'any' type"
    context: string      // File/project context
  },
  output: {
    allowed: boolean,
    rule?: Rule,         // The rule that would be violated
    suggestion?: string  // Alternative action
  }
}
```

**Claude calls this before risky actions.**

#### `log_correction`
```typescript
{
  name: "log_correction",
  description: "Log when user corrects Claude",
  input: {
    userMessage: string,
    assistantContext: string,
    project: string,
    file?: string
  },
  output: {
    patternId: string,
    proposedRule?: Rule  // If pattern warrants a new rule
  }
}
```

**Claude calls this when it detects a correction.**

#### `get_pending_rules`
```typescript
{
  name: "get_pending_rules",
  description: "Get rules awaiting user approval",
  output: {
    rules: Rule[]
  }
}
```

#### `approve_rule` / `reject_rule`
```typescript
{
  name: "approve_rule",
  input: { ruleId: string },
  output: { success: boolean }
}
```

---

### 6. CLI Commands

```bash
# Daemon management
claude-learner start          # Start watcher + MCP server
claude-learner stop           # Stop daemon
claude-learner status         # Show daemon status

# Rules
claude-learner rules          # List active rules
claude-learner rules pending  # Show proposed rules
claude-learner rules approve <id>
claude-learner rules reject <id>
claude-learner rules prune    # Remove low-compliance rules

# Analysis (v1 commands still work)
claude-learner analyze        # One-shot analysis
claude-learner stats          # Usage statistics
claude-learner export         # Export to files

# MCP
claude-learner mcp install    # Add to Claude Code config
claude-learner mcp uninstall  # Remove from config
```

---

## User Flows

### Flow 1: First Install

```
$ npx claude-learner start

🧠 claude-learner v2.0

Analyzing your history...
✔ Found 847 messages across 23 sessions
✔ Detected 12 correction patterns

📬 3 rules proposed:
   1. "Avoid using 'any' in TypeScript" (4 corrections)
   2. "Run tests before committing" (3 corrections)  
   3. "Use early returns" (5 refactors)

[A]pprove all  [R]eview  [S]kip for now

> a

✅ 3 rules activated
🔌 MCP server running on stdio

Add to Claude Code:
  claude mcp add claude-learner -- npx claude-learner mcp-serve

Done! Claude will now learn from your corrections.
```

### Flow 2: Real-time Learning

```
# User is in Claude Code session...

User: "No, use const not let here"
Claude: [internally calls log_correction]
        [pattern detected, proposes rule]

# Next time user runs 'claude-learner status':

📬 1 new rule proposed:
   "Prefer const over let when not reassigning"
   Source: 3 corrections this week

[A]pprove  [R]eject  [L]ater
```

### Flow 3: Rule Check (in Claude Code)

```
# Claude is about to write code...

Claude: [calls check_rule("Using any type", "src/utils.ts")]
        
Response: {
  allowed: false,
  rule: "Avoid using 'any' in TypeScript",
  suggestion: "Use 'unknown' or define a proper type"
}

Claude: "I was about to use 'any' but your rules say to avoid it.
         Using 'unknown' instead."
```

### Flow 4: Auto-Pruning

```
$ claude-learner status

📊 Rule Effectiveness

✅ HIGH (>80% compliance):
   • "Use 2-space indentation" — 94% (47/50)
   • "Run tests before commit" — 88% (22/25)

⚠️  LOW (<30% compliance):
   • "Keep functions under 50 lines" — 18% (2/11)
   
💡 Recommendation: Prune "Keep functions under 50 lines"?
   It's been violated 9 times — Claude isn't following it.
   
[P]rune  [S]trengthen  [K]eep

> p

✅ Rule pruned. Saved ~50 tokens per session.
```

---

## Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | 20+ |
| Language | TypeScript | 5.x |
| File watching | @parcel/watcher | latest |
| MCP SDK | @modelcontextprotocol/server | 1.x |
| Database | better-sqlite3 | latest |
| Schema validation | Zod | 3.x |
| CLI framework | Commander | 12.x |
| Progress/UI | ora, chalk | latest |

---

## File Structure

```
claude-learner/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── daemon/
│   │   ├── watcher.ts        # @parcel/watcher integration
│   │   ├── analyzer.ts       # Pattern detection (enhanced)
│   │   └── server.ts         # Daemon process manager
│   ├── rules/
│   │   ├── engine.ts         # Rule state machine
│   │   ├── effectiveness.ts  # Compliance tracking
│   │   └── proposer.ts       # Pattern → Rule conversion
│   ├── mcp/
│   │   ├── server.ts         # MCP server implementation
│   │   └── tools.ts          # Tool definitions
│   ├── storage/
│   │   ├── db.ts             # SQLite wrapper
│   │   └── migrations.ts     # Schema migrations
│   └── cli/
│       ├── commands/         # CLI command handlers
│       └── ui.ts             # Interactive prompts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Migration from v1

**v1 users:**
- All v1 commands still work (`analyze`, `improve`, `export`)
- `claude-learner start` enables v2 features
- Existing analysis is preserved

**Breaking changes:**
- None. v2 is additive.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to first rule | < 30 seconds |
| CPU when idle | < 1% |
| Memory footprint | < 50MB |
| Rule proposal accuracy | > 70% accepted |
| MCP response time | < 100ms |

---

## Implementation Phases

### Phase 1: Daemon + Watcher (Week 1)
- [ ] @parcel/watcher integration
- [ ] Background daemon with pm2/native
- [ ] Real-time session monitoring
- [ ] SQLite storage

### Phase 2: MCP Server (Week 1-2)
- [ ] MCP server with stdio transport
- [ ] `get_rules`, `check_rule`, `log_correction` tools
- [ ] Claude Code integration (`mcp add`)

### Phase 3: Rule Engine (Week 2)
- [ ] Propose → Approve → Active flow
- [ ] Effectiveness tracking
- [ ] Auto-pruning logic

### Phase 4: Polish (Week 3)
- [ ] Interactive CLI (`rules pending`)
- [ ] Notifications (proposed rules)
- [ ] Documentation + examples
- [ ] npm publish v2.0.0

---

## Open Questions

1. **Notification delivery** — How to notify user of proposed rules?
   - Terminal notification on next CLI run?
   - Desktop notification via node-notifier?
   - Both?

2. **MCP vs File injection** — Should rules also write to CLAUDE.md?
   - Pro: Works without MCP, visible to user
   - Con: Duplicated, can drift

3. **Multi-machine sync** — How to sync rules across machines?
   - Git-based sync of `~/.claude-learner/`?
   - Cloud sync (future)?

---

## The Magic Moment

User installs, runs `claude-learner start`, and within 30 seconds sees:

```
🧠 Found 3 patterns in your history:
   
   1. You corrected indentation 4 times → Rule proposed
   2. You said "run tests" 3 times → Rule proposed  
   3. You reverted 'any' types 2 times → Rule proposed

Claude Code will now follow these rules automatically.
```

**That's the moment they share it on Twitter.**
