

# Security Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for security review. Violations require the AI agent to refuse, rewrite, or block the artifact. Two sections — §A classic AppSec (OWASP-aligned), §B AI-era (prompt injection, MCP threats, agent confused-deputy).

This skill reads `security.severityFloor` (default `medium`), `security.includeAi` (default `true`), and `security.scope` (default `["classic", "ai", "supply-chain"]`) from `.ai/workflows.config.json`. Skip with `skills.securityRules.enabled: false`. When `security.includeAi: false`, §B rules are not enforced (e.g. backend services with no model / MCP surface).

Severity floor semantics: findings at `severity >= severityFloor` block `/flow:validate`; lower severities are warnings. Every rule below carries an implicit default severity — `critical` for code execution / data exfiltration / auth bypass; `high` for data leak / privilege escalation; `medium` for missing-defense-in-depth.

---
