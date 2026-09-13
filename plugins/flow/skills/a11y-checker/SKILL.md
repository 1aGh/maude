---
name: a11y-checker
type: skill
description: "Audit UI accessibility and report actionable WCAG findings with evidence."
keywords:
  [
    accessibility,
    a11y,
    wcag,
    aria,
    contrast,
    screen-reader,
    keyboard,
    axe-core,
    audit,
  ]
---

# A11y Checker

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Runs automated and semi-automated accessibility audits on your web application. Combines static analysis (ESLint jsx-a11y), runtime scanning (axe-core via Playwright), and a manual review checklist.

## When to Use This Skill

- Before publishing or deploying components
- During `validate/a11y` workflow
- After modifying UI components (`.tsx` / `.jsx` files)
- When CI reports accessibility-related failures
- When reviewing new components for WCAG AA compliance

## Prerequisites

- Run from project root
- Node.js and your package manager available in PATH
- For runtime audits: `@axe-core/playwright` and `@playwright/test` must be installed (the script will check and prompt if missing)

## Quick Run

```bash
bash .claude/skills/a11y-checker/scripts/a11y-audit.sh
```

### Options

```bash
# Run only static analysis (ESLint jsx-a11y)
bash .claude/skills/a11y-checker/scripts/a11y-audit.sh --static

# Run only runtime axe-core audit
bash .claude/skills/a11y-checker/scripts/a11y-audit.sh --runtime

# Audit a specific component file
bash .claude/skills/a11y-checker/scripts/a11y-audit.sh --file src/components/button.tsx

# Full audit (default — static + runtime + checklist)
bash .claude/skills/a11y-checker/scripts/a11y-audit.sh
```

## Validation Steps

The script performs these checks in order:

### 1. Static Analysis — ESLint jsx-a11y

Runs `eslint-plugin-jsx-a11y` rules against source files. This catches:

- Missing `alt` text on images
- Missing accessible names on interactive elements
- Invalid ARIA attributes
- Missing form labels
- Incorrect role usage

### 2. Runtime Audit — axe-core via Playwright (if available)

Launches the app (or uses a running dev server) and runs `@axe-core/playwright` against key pages:

- Homepage / landing page
- Primary feature pages
- Form-heavy pages

Reports violations grouped by impact: **critical**, **serious**, **moderate**, **minor**.

### 3. Color Contrast Check

Scans CSS/token files for potential contrast issues:

- Checks foreground/background pairs in theme definitions
- Flags pairs that may not meet WCAG AA (4.5:1 for normal text, 3:1 for large text)

### 4. Manual Review Checklist

Outputs a checklist for items that cannot be fully automated:

#### Critical (blocks interaction)

- [ ] All interactive elements have accessible names
- [ ] Keyboard navigation works (Tab, Enter, Escape, Arrow keys)
- [ ] Focus is not trapped (except intentional modals)
- [ ] No content inaccessible to screen readers

#### Serious (hurts usability)

- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 large text, 3:1 UI)
- [ ] Focus indicators visible
- [ ] Error messages announced to screen readers
- [ ] Form labels associated with inputs

#### Moderate (best practices)

- [ ] ARIA attributes correct and not redundant
- [ ] Heading hierarchy logical (no skipped levels)
- [ ] Images have appropriate alt text
- [ ] Touch targets at least 44×44px

#### Minor (enhancements)

- [ ] Landmark regions used appropriately
- [ ] Skip navigation link present
- [ ] Live regions for dynamic content

## Output Format

```
=== A11y Audit Results ===
Static Analysis: ✅ / ❌ ({N} issues)
Runtime Audit:   ✅ / ❌ ({N} violations) / ⚠️ skipped
Contrast Check:  ✅ / ❌ ({N} potential issues)
Manual Checklist: (printed above)

Overall: ✅ / ❌
```

## Troubleshooting

### `@axe-core/playwright` not installed

The runtime audit requires `@axe-core/playwright` as a dev dependency:

```bash
<pm> add -D @axe-core/playwright @playwright/test
```

The script will skip this step gracefully and report it as a warning if the package is missing.

### Dev server not running

The runtime audit needs the app accessible. The script will attempt to start one temporarily. If it fails, start it manually:

```bash
<pm> run dev &
```

### ESLint jsx-a11y not reporting issues

Verify your ESLint config includes the a11y plugin (`eslint-plugin-jsx-a11y`).

## References

- [WCAG 2.1 AA Guidelines](https://www.w3.org/WAI/WCAG21/quickref/?currLevel=aa)
- [axe-core Rule Descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
- [eslint-plugin-jsx-a11y Rules](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#supported-rules)
