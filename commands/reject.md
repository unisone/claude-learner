---
name: learner:reject
description: Reject a pending rule by ID
args:
  - name: id
    description: Rule ID to reject
    required: true
---

# Reject Pending Rule

Reject the rule with the given ID:

```bash
claude-learner reject $ARGUMENTS
```

After rejection, confirm the rule has been rejected and won't be applied.
