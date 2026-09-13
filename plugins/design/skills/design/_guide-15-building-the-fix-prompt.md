### Building the fix prompt

For each of the top 3 blockers (sorted by severity = a11y > ds-tokens > scope-specific):

```
Auto-fix iteration {N}: {agent} flagged {blockers} blockers; addressing top {3}:

1. [{category}] line {N}: {summary}
   Fix: {fix from verdict.}

2. ...

Apply ONLY these fixes. Preserve existing tokens, rootClass, and structure. After each fix, the critic will re-run; do not pre-emptively address other findings.
```

The orchestrator uses Edit tool with old_string scoped to the line range from the verdict.
