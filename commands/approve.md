---
name: learner:approve
description: Approve a pending rule by ID
args:
  - name: id
    description: Rule ID to approve
    required: true
---

# Approve Pending Rule

Approve the rule with the given ID:

```bash
claude-learner approve $ARGUMENTS
```

After approval, confirm:
1. The rule is now active
2. What the rule does
3. It will be applied to future sessions
