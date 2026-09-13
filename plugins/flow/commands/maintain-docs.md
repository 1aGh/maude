---
name: maintain-docs
category: maintain
type: command
description: "Check documentation freshness and stale references."
keywords: [documentation, freshness, stale, references, scan]
---

# Maintain: Documentation Freshness

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

> Scans content, AGENTS files, READMEs, and AI docs for references that have drifted from actual code.

## Step 1: Scan for known stale patterns

Run project-specific grep patterns and report any matches as **stale references**.

### Project-Specific Stale Patterns

> Add patterns relevant to your project below. Examples:
>
> ```bash
> # Old architecture references
> grep -rn "old-pattern\|deprecated-term" docs/ content/ README.md --include="*.md" --include="*.mdx" 2>/dev/null
>
> # Old paths or package names
> grep -rn "old-package-name\|legacy-path" src/ docs/ --include="*.ts" --include="*.tsx" --include="*.md" 2>/dev/null
> ```

Scan all documentation-related files for patterns that indicate stale references:

```bash
# Scan AI docs for references to files that no longer exist
for ref in $(grep -roh '\./[a-zA-Z0-9/_.-]*\.md' .ai/docs/ CLAUDE.md README.md 2>/dev/null | sort -u); do
  if [ ! -f "$ref" ]; then echo "STALE REF: $ref"; fi
done
```

## Step 2: Cross-check key numbers

Verify that numbers mentioned in documentation match reality:

```bash
# Count assets by type and compare against CLAUDE.md claims
echo "Commands: $(find commands -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
echo "Agents: $(find agents -name '*.agent.md' 2>/dev/null | wc -l | tr -d ' ')"
echo "Skills: $(find skills -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
echo "Prompts: $(find prompts -name '*.prompt.md' 2>/dev/null | wc -l | tr -d ' ')"
```

Compare against what docs say and flag discrepancies.

## Step 3: Check for dead links in documentation

```bash
# Internal links that reference non-existent files
grep -roh '\]([^)]*\.md[^)]*)' docs/ CLAUDE.md README.md 2>/dev/null | \
  sed 's/\](//' | sed 's/)$//' | sort -u | while read link; do
    # Strip anchors
    file=$(echo "$link" | cut -d'#' -f1)
    if [ -n "$file" ] && [ ! -f "$file" ]; then echo "DEAD LINK: $link"; fi
  done
```

## Step 3b: Reconcile PRD/docs against loaded skills

> Bridges documentation drift with capability drift — when the PRD names a library nobody has expertise on, we want to know **now**, not when /flow:execute runs.

Scan PRD + AI docs for named libraries/frameworks/services:

```bash
# Pull a candidate set from PRD, plans, DDRs, and CLAUDE.md
DOC_PATHS=(.ai/prd.md .ai/docs/ .ai/decisions/ plans/ CLAUDE.md README.md)
grep -rho -E '\b(yjs|drizzle|hono|trpc|effect|prisma|convex|expo|next|nuxt|svelte|astro|remix|tanstack|zustand|jotai|valtio|pixi\.?js|three\.?js|d3|gsap|framer-motion|tailwind|stitches|emotion|playwright|vitest|jest|cypress|mongoose|kysely|supabase|firebase|stripe|clerk|auth\.?js|nextauth|lucia|better-auth)\b' "${DOC_PATHS[@]}" 2>/dev/null \
  | tr '[:upper:]' '[:lower:]' | sort -u
```

> Augment the regex with any project-specific libraries your team uses. Treat the list as a starter, not exhaustive.

Then invoke `Skill(flow:skill-loader)` with that candidate set. The skill will:

1. Diff each candidate against skills loaded in this session and against the persisted set in `.ai/state/STATE.md`.
2. Fetch any missing skill via the `terminal-skills` MCP (or WebFetch fallback).
3. Update the persisted record.

Report:

```
Skills: ✅ / ⚠️ {N libs in docs without loaded skill}
- Newly resolved: {lib → skill source}
- Still missing: {lib — no MCP match, consider manual /flow:make-skill-template}
```

If a doc names a library and `skill-loader` cannot resolve it via MCP or docs, flag it for follow-up — either delete the doc reference (drift) or scaffold a local skill via `/flow:make-skill-template`.

## Step 4: Cross-reference validation

Check references across AI docs, READMEs, and workflow files:

```bash
# Commands referenced in CLAUDE.md that don't exist
grep -oE '`[a-z/-]+`' CLAUDE.md 2>/dev/null | tr -d '`' | while read cmd; do
  if [ -f "commands/${cmd}.md" ] || [ -d "commands/${cmd}" ]; then
    : # exists
  fi
done
```

Report broken cross-references alongside the Step 3 dead links.

## Output

Report as:

```
Docs: ✅ / ⚠️ {N stale references}
- Stale patterns: {list with file:line}
- Number mismatches: {list}
- Dead links: {list}
```
