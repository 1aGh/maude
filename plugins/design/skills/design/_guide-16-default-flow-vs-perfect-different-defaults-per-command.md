### Default flow vs. `--perfect` — different defaults per command

Two commands, two defaults. **The defaults differ because the leverage differs**:

- `/design:edit "<feedback>"` is incremental — small edit on existing canvas. Default = solid-for-review (max 4 iter, aspiration 4.0). User can iterate cheaply, so over-investing in any one edit is waste.
- `/design:new` is high-leverage scaffold — sets the canvas trajectory for all future iteration. Default = portfolio-grade (`--perfect`: max 8 iter, aspiration 4.5, full panel). Cheap to do right once; expensive to refactor afterwards.

| Command + flag | max_iter | aspiration_target | Critic panel | Auto-fix | Use case |
|---|---|---|---|---|---|
| `/design:edit` (none) | 4 | 4.0 / 5 | routed panel (signature-moment-critic added when polish/nicer/elegant cues in feedback) | yes | typical incremental edit — solid-for-review |
| `/design:edit --perfect [N]` | N (default 8) | 4.5 / 5 | routed panel including signature-moment-critic | yes | "make this right" — extended polish on existing canvas |
| `/design:edit --perfect --all` | N | 4.5 / 5 | **every critic** | yes | exhaustive polish |
| `/design:edit --no-critic` | 0 | n/a | (skip) | no | quick / dirty edit |
| **`/design:new` (none — DEFAULT = `--perfect`)** | **8** | **4.5 / 5** | **signature-moment + design + frontend + a11y (if interactive)** | **yes** | **standard new canvas — portfolio-grade scaffold** |
| `/design:new --perfect-iter N` | N | 4.5 / 5 | same as default | yes | larger / smaller canvases that need more / fewer iterations |
| `/design:new --perfect --all` | 8 | 4.5 / 5 | **every critic** | yes | exhaustive — portfolio + comprehensive coverage |
| `/design:new --quick` | 2 | 4.0 / 5 | signature-moment-critic only | yes | throwaway exploration / proof-of-concept |
| `/design:new --no-critic` | 0 | n/a | (skip) | no | testing / debug — just verify file generates |

**Distinguishing the modes in one line:**
- **`/design:edit` default** = "is this solid enough that the user can productively review it?" → loop until aspiration ≥ 4 + correctness clean + stable.
- **`/design:new` default (= `--perfect`)** = "is this a scaffold worth iterating from?" → loop until aspiration ≥ 4.5 + correctness clean + stable, OR exit `stable-but-bland` with diagnostic. New canvases get the higher bar by default because they set the trajectory for all future iteration.
- **`--perfect` on `/design:edit`** = "treat this incremental edit like a scaffold — broader knobs, higher target."
- **`--quick` on `/design:new`** = "this is a throwaway exploration, don't burn 40 critic calls." Explicit opt-out from default contract.

All modes share the same exit conditions (`SOLID`, `stable-but-bland`, `max-reached`, `divergent`, `validation-failed`) — different `max_iter` / `aspiration_target` / panel just give the loop different rope before tripping them.
