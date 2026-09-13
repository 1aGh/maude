## 4. Element / link vocabulary (glossary — open-ended by design)

kgai is schema-free; a "kind" is just a string. This glossary is the shared vocabulary so decisions record into a consistent shape. **A new command/skill inherits the backend automatically** — it only needs to (1) name any new node kind here, and (2) if its output lands via a dev-server route rather than a model file-edit, add one server-side emit site (see Task 8 / the footage note).

**Repo-local kinds are namespaced `<repo>/<slug>`; shared kinds never are.** The `<repo>/` prefix below is part of the name, not a display convention — see the namespacing rule in the WRITE section.

| Kind | Source | Notable edges |
| --- | --- | --- |
| `decision:<repo>/<slug>` | `/flow:record-ddr`, DDR-worthy writes, log verdicts | `SUPERSEDES`/`OVERRIDES`/`REFERENCES`/`EXTENDS` → decision; `DECIDED_IN` → plan; `IN_REPO`/`IN_DEPT` → scope (**both mandatory**) |
| `plan:<repo>/<slug>` | `/flow:plan`, `/flow:setup-prd` | `path` prop → on-disk MD (prose stays on disk); `IN_REPO`/`IN_DEPT` → scope (**both mandatory**) |
| `milestone:<repo>/<slug>` / `working-state:<repo>/<slug>` | `/flow:done`, `/flow:pause`, plan closes | `IN_REPO`/`IN_DEPT` → scope (**both mandatory**) |
| `repo:<name>` / `dept:<name>` | `config.scope` (every write) | scope anchors — **never namespaced** |
| `ds:<name>` | `/design:setup-ds` LOCK gate | `direction:<ds>-locked` ← `research:<sha>` |
| `canvas:<slug>` | `/design:new`, `.meta.json` | `RENDERS` → ds; `USES_BRAND` → brand |
| `edit:<slug>-NNN` | `/design:edit` | `MUTATES` → canvas (verbatim feedback prop) |
| `footage:<sha8>` | `footage-store.ts` server write (`PUT /_api/footage`) | `FROM` → asset; child `shot:` |
| `reel:<slug>` | `footage-store.ts` (EDL sidecar) | `USES` → footage; `RENDERS_AS` → video-comp canvas |
| `rca:` / `code-review:` / `security-review:` / `system-review:` / `execution-report:` / `a11y-audit:` / `visual-review:` | `/flow:bug-rca`, `review-code`, `validate-security`, `record-retro`, `record-execution`, `validate-a11y`, `validate-visual` — via `kg record-log` | `ABOUT` → `area:<kind>`; `EVIDENCE_FOR` → each cited decision |
| `critic-verdict:` / `keeper-finding:` / `handoff:` | `/design:critic`, `design-system-keeper`, `/design:handoff` — via `kg record-log --about canvas:<slug>` | `EVALUATES` / `FLAGS` / `HANDED_OFF` → canvas |
| `draw:` / `board:` | `/design:draw`, `/design:board` (board only when a session settled something) | `DRAWN_FOR` / `ANNOTATES` → canvas |
| `direction:<ds>-locked` | `/design:setup-ds` LOCK gate (DDR-147) | `ds:` —`LOCKED_TO`→ direction |

**Server-write nuance:** kgai's autonomous Stop hook counts **edit-tool** uses (`Edit`/`Write`/`MultiEdit`), so it catches a model-written `.tsx`/`.meta.json` but **NOT** a dev-server-written sidecar (`PUT /_api/footage`, photo-edit). Those need an explicit emit at the server write path (one site, covers UI + CLI + agent callers).
