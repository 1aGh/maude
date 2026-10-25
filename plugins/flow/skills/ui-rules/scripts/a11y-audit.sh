#!/usr/bin/env bash

# A11y Checker — Generic Accessibility Audit
# Run from project root: bash .claude/skills/ui-rules/scripts/a11y-audit.sh
#
# Options:
#   --static   Run only ESLint jsx-a11y static analysis
#   --runtime  Run only axe-core runtime audit
#   --file <path>  Audit a specific file (static only)
#   (no args)  Full audit: static + runtime + checklist

set -euo pipefail

ERRORS=0
WARNINGS=0
MODE="full"
TARGET_FILE=""

# --- Parse Arguments ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --static)  MODE="static"; shift ;;
        --runtime) MODE="runtime"; shift ;;
        --file)    TARGET_FILE="$2"; MODE="static"; shift 2 ;;
        *)         echo "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Detect package manager ---
if [ -f "pnpm-lock.yaml" ]; then
    PM="pnpm"
    PM_EXEC="pnpm exec"
elif [ -f "yarn.lock" ]; then
    PM="yarn"
    PM_EXEC="yarn"
elif [ -f "package-lock.json" ]; then
    PM="npm"
    PM_EXEC="npx"
else
    PM="npm"
    PM_EXEC="npx"
fi

echo "=== A11y Audit ==="
echo "Package manager: $PM"
echo ""

# ─────────────────────────────────────────────
# Step 1: Static Analysis — ESLint jsx-a11y
# ─────────────────────────────────────────────
run_static() {
    echo "Step 1: Static analysis (ESLint jsx-a11y)..."

    # Verify eslint is available
    if ! $PM_EXEC eslint --version > /dev/null 2>&1; then
        echo "  ❌ ESLint not found. Run: $PM install"
        ERRORS=$((ERRORS + 1))
        return
    fi

    # Run ESLint and filter for a11y issues
    local LINT_OUTPUT
    if [ -n "$TARGET_FILE" ]; then
        if [ -f "$TARGET_FILE" ]; then
            LINT_OUTPUT=$($PM_EXEC eslint --no-error-on-unmatched-pattern "$TARGET_FILE" 2>&1) || true
        else
            echo "  ❌ File not found: $TARGET_FILE"
            ERRORS=$((ERRORS + 1))
            return
        fi
    else
        LINT_OUTPUT=$($PM run lint 2>&1) || true
    fi

    local A11Y_ISSUES
    A11Y_ISSUES=$(printf '%s' "$LINT_OUTPUT" | grep -c "jsx-a11y" || true)
    A11Y_ISSUES=$((A11Y_ISSUES + 0))  # ensure integer

    if [ "$A11Y_ISSUES" -eq 0 ]; then
        echo "  ✅ No jsx-a11y issues found"
    else
        echo "  ❌ Found $A11Y_ISSUES jsx-a11y issues:"
        echo "$LINT_OUTPUT" | grep "jsx-a11y" | head -20 | while IFS= read -r line; do
            echo "    $line"
        done
        if [ "$A11Y_ISSUES" -gt 20 ]; then
            echo "    ... and $((A11Y_ISSUES - 20)) more"
        fi
        ERRORS=$((ERRORS + A11Y_ISSUES))
    fi
}

# ─────────────────────────────────────────────
# Step 2: Runtime Audit — axe-core via Playwright
# ─────────────────────────────────────────────
run_runtime() {
    echo "Step 2: Runtime audit (axe-core)..."

    # Check if @axe-core/playwright is available
    if ! node -e "require.resolve('@axe-core/playwright')" 2>/dev/null; then
        echo "  ⚠️  @axe-core/playwright not installed — skipping runtime audit"
        echo "     Install with: $PM install -D @axe-core/playwright @playwright/test"
        WARNINGS=$((WARNINGS + 1))
        return
    fi

    # Check if dev server is running on port 4000 or 4001
    local DEV_URL=""
    local HTTP_CODE
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000 2>/dev/null) || true
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
        DEV_URL="http://localhost:4000"
    else
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4001 2>/dev/null) || true
        if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
            DEV_URL="http://localhost:4001"
        fi
    fi

    if [ -z "$DEV_URL" ]; then
        echo "  ⚠️  No dev server detected on port 4000 or 4001 — skipping runtime audit"
        echo "     Start your dev server first"
        WARNINGS=$((WARNINGS + 1))
        return
    fi

    echo "  Using dev server at $DEV_URL"

    # Create temporary Playwright test for axe-core
    local TEMP_TEST
    TEMP_TEST=$(mktemp /tmp/ai-workflow-a11y-XXXXXX)
    mv "$TEMP_TEST" "${TEMP_TEST}.mjs"
    TEMP_TEST="${TEMP_TEST}.mjs"

    cat > "$TEMP_TEST" << TESTEOF
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DEV_URL = '${DEV_URL}';
const pages = [
    { name: 'Homepage', path: '/' },
];

let totalViolations = 0;

const browser = await chromium.launch();
const context = await browser.newContext();

for (const p of pages) {
    const page = await context.newPage();
    try {
        await page.goto(DEV_URL + p.path, { timeout: 15000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();

        if (results.violations.length === 0) {
            console.log('  ✅ ' + p.name + ' (' + p.path + ') — no violations');
        } else {
            totalViolations += results.violations.length;
            console.log('  ❌ ' + p.name + ' (' + p.path + ') — ' + results.violations.length + ' violations:');
            for (const v of results.violations) {
                console.log('    [' + v.impact + '] ' + v.id + ': ' + v.description + ' (' + v.nodes.length + ' nodes)');
            }
        }
    } catch (e) {
        console.log('  ⚠️  ' + p.name + ' (' + p.path + ') — failed: ' + e.message);
    }
    await page.close();
}

await browser.close();
process.exit(totalViolations > 0 ? 1 : 0);
TESTEOF

    node "$TEMP_TEST" 2>&1 || ERRORS=$((ERRORS + 1))
    rm -f "$TEMP_TEST"
}

# ─────────────────────────────────────────────
# Step 3: Color Contrast Check
# ─────────────────────────────────────────────
run_contrast() {
    echo "Step 3: Color contrast spot check..."

    # Scan for potential low-contrast patterns in CSS/token files
    local LOW_CONTRAST_HITS
    LOW_CONTRAST_HITS=$(grep -rc --include="*.css" --include="*.ts" --include="*.tsx" \
        -E "(color|background).*#[a-fA-F0-9]{3,8}" src/ 2>/dev/null \
        | awk -F: '{s+=$NF} END {print s+0}') || LOW_CONTRAST_HITS=0

    if [ "$LOW_CONTRAST_HITS" -gt 0 ]; then
        echo "  ℹ️  Found $LOW_CONTRAST_HITS color declarations — manual contrast verification recommended"
        echo "     Use a tool like https://webaim.org/resources/contrastchecker/ to verify pairs"
    else
        echo "  ✅ No inline color declarations found (using CSS custom properties)"
    fi
}

# ─────────────────────────────────────────────
# Step 4: Manual Review Checklist
# ─────────────────────────────────────────────
print_checklist() {
    echo "Step 4: Manual review checklist"
    echo ""
    echo "  Critical (blocks interaction):"
    echo "    [ ] All interactive elements have accessible names"
    echo "    [ ] Keyboard navigation works (Tab, Enter, Escape, Arrow keys)"
    echo "    [ ] Focus is not trapped (except intentional modals)"
    echo "    [ ] No content inaccessible to screen readers"
    echo ""
    echo "  Serious (hurts usability):"
    echo "    [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 large text)"
    echo "    [ ] Focus indicators visible"
    echo "    [ ] Error messages announced to screen readers"
    echo "    [ ] Form labels associated with inputs"
    echo ""
    echo "  Moderate (best practices):"
    echo "    [ ] ARIA attributes correct and not redundant"
    echo "    [ ] Heading hierarchy logical (no skipped levels)"
    echo "    [ ] Images have appropriate alt text"
    echo "    [ ] Touch targets at least 44x44px"
}

# ─────────────────────────────────────────────
# Execute based on mode
# ─────────────────────────────────────────────
case "$MODE" in
    static)
        run_static
        ;;
    runtime)
        run_runtime
        ;;
    full)
        run_static
        echo ""
        run_runtime
        echo ""
        run_contrast
        echo ""
        print_checklist
        ;;
esac

# ─────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────
echo ""
echo "=== Summary ==="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "A11y Audit: ✅"
elif [ $ERRORS -eq 0 ]; then
    echo "A11y Audit: ⚠️ ($WARNINGS warnings — some checks skipped)"
else
    echo "A11y Audit: ❌ ($ERRORS issues found)"
fi

exit $ERRORS
