### 4.5. UX patterns research (cache-first)

> **Why this step exists.** Without domain-aware UX research, `frontend-design` invents the IA from scratch for every canvas — leading to generic shapes (5-tab nav, dashboard-card grid, modal-overlay flows) regardless of whether the brief is a recipe app, a sports tracker, or a scientific tool. The `ux-research-agent` (mode `ux-patterns`) builds a domain-aware behavioral pool — typical IA, screen anatomy, common flows, interaction patterns, current UX trends — and `frontend-design` consumes it as part of its reference bundle. **Visual identity is NOT in scope here — the DS owns that, /design:new always uses the finished DS.** The research is purely about **good UX patterns** for the domain.

**Cache key:** `<DESIGN_ROOT>/_history/_system/<TARGET_DS>-<BRIEF_SHA8>-domain-research-ux-patterns.json`. The cache includes the brief hash — two canvases in the same DS with different briefs get separate cache files. The match is exact (hash, not fuzzy semantic similarity); rewording a brief produces a fresh cache key.

```bash
BRIEF_SHA8=$(printf '%s' "$BRIEF" | shasum -a 256 | cut -c1-8)
PAYLOAD="$DESIGN_ROOT/_history/_system/$TARGET_DS-$BRIEF_SHA8-domain-research-ux-patterns.json"

if [[ -f "$PAYLOAD" ]]; then
  echo "→ UX patterns cache hit (brief-hash match: $BRIEF_SHA8) — reusing $PAYLOAD"
else
  echo "→ No cache for brief-hash $BRIEF_SHA8 — running fresh research"
fi
```

**Spawn the agent (only when needed):**

```
Agent(
  description: "UX patterns research for <Name>",
  subagent_type: "design:ux-research-agent",
  prompt: <<EOF
brief:          "<verbatim user brief>"
caller:         "new-canvas"
mode:           "ux-patterns"
context_paths:
  existing_ds_tokens:  "<abs path to DS_TOKENS>"
  existing_ds_readme:  "<abs path to system/<TARGET_DS>/README.md>"
  cached_payload:      "<abs path to PAYLOAD if exists, else empty>"
output_path:    "<abs path to PAYLOAD>"
researched_at:  "<current ISO date>"
EOF
)
```

Wall time ~30–60s when fresh; ~0s on cache hit (the agent reads the cache, validates, returns immediately).

**Read the payload back** with the `Read` tool into your context. It will be passed to `frontend-design` in step 6 as part of the reference bundle alongside the envelope.

**Failure handling:**
- Agent fails entirely (no payload written) → **do not block scaffold**. Surface a warning in the final print (`UX patterns research failed — frontend-design generation proceeded without domain pool; quality may regress to generic-template default`) and continue with envelope-only generation.
- Payload reports `fallback_used: true` → continue normally but surface in final print (`UX patterns research fell back to LLM-knowledge mode — review canvas IA carefully`).
- `/design:edit` does NOT run this step. Edit stays fast — research is on-demand only via `--research` flag (future, not currently shipped).
