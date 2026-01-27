---
name: learner:rules
description: List all learning rules (active, pending, rejected)
---

# List Learning Rules

Run:

```bash
claude-learner rules
```

For pending rules only:
```bash
claude-learner rules --pending
```

For effectiveness report:
```bash
claude-learner rules --effectiveness
```

Present the rules in a clear format showing:
- Rule ID
- Status (active/pending/rejected)
- The pattern that triggered it
- The rule content
- Effectiveness score if available
