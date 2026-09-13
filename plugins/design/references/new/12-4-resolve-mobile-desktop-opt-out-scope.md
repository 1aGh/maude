### 4. Resolve mobile/desktop + opt-out scope

`--mobile` flag, or the name contains `Mobile` / `iOS` / `Android`.

**Opt-out scope resolution** (see SKILL.md "Opt-out scope" for the canonical spec):

```bash
# 1. Explicit flag wins.
SCOPE=$(grep -oE -- '--opt-out=(palette|aesthetic|full)' <<< "$ARGS" | cut -d= -f2)

# 2. Plain-language inference (only if no explicit flag).
if [ -z "$SCOPE" ]; then
  if grep -qiE 'opt[ -]out|off[ -]system|sandbox|custom palette|different brand|fully off|advisory only' <<< "$BRIEF"; then
    INFERRED=$(grep -qiE 'fully off|advisory only|different brand' <<< "$BRIEF" && echo "full" \
            || grep -qiE 'modern (color|scheme|aesthetic)|vibrant|playful|exploration|experimental|consumer-app' <<< "$BRIEF" && echo "aesthetic" \
            || echo "palette")
    # Surface AskUserQuestion before continuing — propose INFERRED, options a/b/c, default a.
    SCOPE=<user_choice_or_palette_in_auto_mode>
  else
    # 3. DS-default from config.aestheticAmbition (DDR-073). The DS's inferred ambition sets the
    #    default scope, so an expressive/maximalist DS doesn't need --opt-out on every canvas.
    #    Legacy/missing field → "restrained" → palette = old behavior (zero regression).
    AMB=$(jq -r '.aestheticAmbition // "restrained"' "${DESIGN_ROOT:-.design}/config.json" 2>/dev/null)
    case "$AMB" in
      maximalist) SCOPE="full" ;;
      expressive) SCOPE="aesthetic" ;;
      *)          SCOPE="palette" ;;   # restrained | confident | legacy/missing
    esac
  fi
fi
```

**Explicit `--opt-out` and plain-language signals still win** (steps 1–2 precede the DS default). A11y is enforced at every scope regardless. The DS default just means "born expressive ⇒ canvases default to `aesthetic`" instead of the universal hardcoded `palette`.

**Resolve the DS-fidelity policy alongside the scope (DDR-141).** `config.dsFidelity` decides the *severity* of reuse findings (invented brand mark, reinvented components, parallel shell) at the resolved scope — `advisory` (default) keeps them warnings; `strict` promotes them to blockers the auto-fix loop must clear. Same axis as `opt_out_scope`, not a competing switch: a resolved scope of `full` (explicit free-use) wins over `strict`.

```bash
DS_FIDELITY=$(jq -r '.dsFidelity // "advisory"' "$CFG" 2>/dev/null || echo advisory)
[[ "$SCOPE" == "full" ]] && DS_FIDELITY="advisory"   # explicit free-use beats project policy (DDR-141)
```

The resolved `SCOPE` is persisted on the canvas's `.meta.json` `opt_out_scope` field (step 11) and passed — together with `DS_FIDELITY` — to every critic in the auto-fix loop (step 10) and to `design-system-keeper` (step 9.5).
