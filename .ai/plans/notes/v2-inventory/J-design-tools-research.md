# J — How AI design tools wire the agent to the document (research, 2026-10-08)

Question: how do AI-native and AI-augmented design tools connect the AI agent to the design document? Specifically:

- **Parity:** can the AI do what the user can do, and the other way round?
- **Access path:** does the AI edit files or code directly, or go through tools (MCP, a plugin API, structured operations)?
- **Agent shape:** one general agent, or specialized agents?

At the end, what this means for Maude's A13 ("files are the API") and for the idea of specialized artboard and annotation agents.

How to read the citations:

- `[n]` points to the source list at the end.
- **[secondary]** means the claim comes from third-party coverage, not the vendor.
- **[unverified]** means the source is unofficial (for example a leaked prompt).
- **[speculation]** marks my own inference.

Tools I could not verify in enough depth are listed at the end, not padded out.

---

## 0. TL;DR (key findings)

1. **Everyone has converged on "the agent writes code against the document", not "the agent calls 40 small tools".**
   - Figma's `use_figma` runs agent-written JavaScript against the Plugin API [9][14].
   - Penpot's MCP centres on `execute_code` [26].
   - tldraw moved its agents from discrete `createShape`/`updateShape` actions, which it found "severely limiting", to raw JavaScript run against the live `Editor` [20][22].
   - Anthropic's own guidance argues the same thing for MCP in general [45].
   - Maude's document *is* code (TSX plus JSON), so Claude Code's native Read/Edit/Write already *is* this "code mode", with no translation layer. That is the strongest position in the market, not a gap.
2. **The file-native tools (HTML, JSX or JSON on disk) still wrap the raw write with invariants.**
   - Pencil tells users not to hand-edit `.pen` JSON and to go through the app, CLI or MCP instead [7].
   - Paper adds explicit node locks [29].
   - Canva wraps edits in transactions that fail on concurrent human edits [39].
   - Figma scripts are atomic [14].
   - tldraw runs a `sanitizeAction()` repair pass before applying anything [18].
   - Lesson for Maude: "files are the API" works only if something *outside the model* enforces the invariants. A13's hooks (`edit.check` / `edit.touched`) plus schema validation fill exactly this slot.
3. **Parity comes from the substrate, not from a parity table.**
   - Where human direct manipulation and AI edits write the *same source*, parity is automatic. Examples: Onlook writes visual edits back through the AST into the same files the AI edits [30]; Lovable does the same [34]; Claude Design's host rewrites `EDITMODE` JSON blocks on disk [4, unverified].
   - Where they don't, users notice. v0's design-mode edits that need an AI "Apply" (paid in credits) to persist drew complaints [33].
4. **Comments, not canvas shapes, are becoming the agent's feedback channel.**
   - tldraw found agent-authored notes and shapes "anonymous" and cluttering. It shipped comments as a separate record that "sits parallel to the canvas", which agents and humans use through the same tools [21].
   - Claude Design batches selected inline comments to Claude [6, secondary].
   - Figma's agent summarises comment threads [12].
5. **Specialized agents in production design tools are rare and narrow.**
   - The typical shape is **one general agent plus skills** (Figma [11][14], Framer [37], Pencil and Paper via the user's own agent), plus at most a **separate clean-context verifier or reviewer** (Claude Design's `fork_verifier_agent` [4, unverified]).
   - Role-specialized agents show up where they give *perspectives*, not edits (Miro Sidekicks: "Product Leader", "Agile Coach" [40]).
   - The one real multi-agent canvas experiment, tldraw Fairies (an orchestrator plus workers), was kept on-canvas and short-task. tldraw's next step was a local coding agent with code mode, not more agents [20][22].
   - The engineering evidence agrees: multi-agent works for reads and clean-context review, and is fragile for parallel writers on shared context [43][44].
6. **Implication for Maude.**
   - Keep one writer per artboard.
   - Teach artboards and annotations as **skills** of the main agent, not as separate agents.
   - Use subagents only for:
     - (a) clean-context critique (already done);
     - (b) read-only digestion of a big board into a brief;
     - (c) disjoint parallel variant generation, where each subagent owns its own artboard or file;
     - (d) closed verification loops that produce a file (draw-agent).

---

## 1. Per-tool findings

Legend for each tool:

- **Format:** the document format, and whether it is human-readable and on disk.
- **Edit path:** how the AI edits the document.
- **Agents:** one agent or specialized ones.
- **Safety:** reversibility, plus concurrency between people and AI.
- **Parity:** AI-only vs user-only, and how capabilities are shared.
- **Annotations:** whether the AI can read and write comments or annotations.

### 1.1 Claude Design (Anthropic Labs) and Claude Code

- **Format.**
  - Launched 2026-04-17 as a research preview with a chat pane and a live canvas [1].
  - Official sources mention "code-powered prototypes" and export to standalone HTML, PDF, PPTX and Canva, but not the storage format [1].
  - **[unverified]** A leaked system prompt shows projects as **files**: HTML pages, inline JSX through Babel standalone, and starter components such as `design_canvas.jsx`, `ios_frame.jsx` and `deck_stage.js` [4]. That is structurally very close to Maude's `DesignCanvas`/`DCArtboard` model.
- **Edit path.**
  - **[unverified]** Generic file tools: `read_file`, `write_file`, `str_replace_edit`, `copy_files`, `grep`, `run_script` [4]. So this is "files are the API" inside Anthropic's own design product.
  - **[unverified]** User-selected elements arrive as attachments carrying `react:` (component chain), `dom:` (ancestry) and `id:` (a runtime handle such as `data-cc-id`). The model can probe the live preview with `eval_js_user_view` [4].
  - Officially: refine "through conversation, inline comments, direct edits or custom sliders"; the sliders are "made by Claude" [1].
  - The June 2026 update added a direct-manipulation editor ("drag, resize, and align elements") [2].
  - **[unverified]** The sliders are a protocol, not a tool. The page registers `__edit_mode_*` postMessage handlers, and the defaults sit in a JSON block between `/*EDITMODE-BEGIN*/` and `/*EDITMODE-END*/`. "The host rewrites [it] on disk" [4]. In other words, a human tweak becomes a deterministic file write that the AI later sees, which is parity through the file.
- **Agents.**
  - **[unverified]** One main agent plus a single forked verifier (`fork_verifier_agent`), which runs "in the background with its own iframe" after `done` [4].
  - No other specialist agents are described. Officially: "checks its output against your design system, and makes corrections before you see it" [2].
- **Safety.**
  - Versioning is not documented officially. **[unverified]** The prompt tells the model to copy a file before significant revisions ("My Design v2.html") [4].
  - Admins can lock a standard design system [2].
  - Sharing levels are view, comment, and edit with group chat with Claude [5][6, secondary].
- **Claude Code bridge.**
  - `/design-sync` pulls a design system into Claude Design and pushes built work back to the canvas [2][3].
  - `/design` in Claude Code creates, edits and syncs design projects [2].
  - Handoff is a "bundle" that Claude Code "continues from … instead of starting over from a screenshot" [1][2].
  - The transfer format is not documented [3].
- **Annotations.**
  - Inline comments on elements [1].
  - **[secondary]** Comments carry a "Select for Send to Claude" checkbox and are resolved in one batch. There is a known bug where comments vanish before Claude reads them [6].

### 1.2 Pencil (pencil.dev)

- **Format.**
  - `.pen` is JSON, "structured, readable data", saved in the project folder and committed to Git "like a code file" [7].
  - Merge conflicts: keep both versions and reapply the changes in the app. The docs advise **not** resolving conflicts by editing the JSON [7].
  - (The core-concepts page reportedly mentioned encryption, and that page now 404s, so this is unresolved.)
- **Edit path.**
  - "Modify `.pen` files with pen.dev, the CLI or the MCP tools", not by direct JSON edits [7].
  - **[secondary]** Tool loop [8]:
    - `batch_get` reads and searches nodes;
    - `batch_design` does insert, copy, update, replace, move and delete, with community guides recommending at most about 25 operations per call;
    - `snapshot_layout` returns bounding boxes for overflow and clipping checks;
    - `get_screenshot` gives visual verification;
    - `get_editor_state` returns the current selection.
- **Agents.** Pencil has no agent of its own. It runs a local MCP server and the user's coding agent (Claude Code, Cursor, Codex) drives it [8].
- **Safety.** Git is the version history. The desktop app keeps a recovery backup that "is not version history" [7]. Auto-save was missing at one point [7].
- **Takeaway.** Pencil is the closest analogue to Maude (a local, git-friendly, human-readable format). Even so, it chose *batched structured operations* over raw file edits, presumably to protect schema invariants. **[speculation]**

### 1.3 Figma: MCP server, the in-app agent, Make, FigJam

- **Format.** A proprietary, server-side scene graph, not on disk. Agents see it through:
  - a sparse XML outline (`get_metadata`);
  - design context (`get_design_context`);
  - FigJam as XML plus screenshots (`get_figjam`) [10].
- **Edit path, external agents (remote MCP).**
  - `use_figma` lets the client "execute JavaScript in the context of a Figma file through the Plugin API" [9].
  - It is the general-purpose writer for Design, FigJam and Slides. The other write tools are specialised generators: `generate_figma_design` (live HTML to layers), `generate_diagram` (Mermaid to FigJam), `upload_assets`, `create_new_file` [10].
  - Figma states the goal as "working toward **parity with the Plugin API**" [11].
  - Limits: a 20 KB response cap, no images inside scripts, no custom fonts [9].
- **Edit path, Figma's own agent.**
  - Launched in May 2026 and in open beta for paid plans since Config (2026-06-24) [12][13].
  - "Fine-tuned for editing Figma files … built for direct manipulation so you can stay in control" [12].
  - You can start a prompt from any layer, @-mention tokens and components, run multiple prompts at once, and keep editing while it iterates [12].
- **Skills instead of agents.**
  - "Skills, a set of instructions, written as markdown files" shape how agents build on the canvas [11].
  - The foundational `/figma-use` skill teaches the API; other skills (`figma-generate-design`, `figma-generate-library`, `figma-use-figjam`, …) build on it [9][14].
  - The FigJam skill specialises *by reference file*, not by agent: `create-sticky`, `create-section`, `create-connector`, `position-figjam-nodes`, `plan-board-content` [14].
  - Figma's whiteboard capability is therefore **one general agent plus a skill with per-element references**.
- **Safety.**
  - Failed `use_figma` scripts are **atomic**: "no changes are made to the file" [14].
  - The skill insists on small incremental steps, returning every created or mutated node ID, and validating with `get_metadata` plus screenshots [14].
  - Sections under construction carry `placeholder = true` so the user sees progress [14].
  - Writes need a Full seat and edit permission [9].
  - Undo, per the community: the in-chat Undo button covers **only the most recent agent turn**. After that the only option is a whole-file version restore, which is "holistic to the entire file" [16, community forum]. A forum thread is titled "I lost work with Figma AI Agents" [16].
  - Figma Make adds a checkpoint per chat revision and per-file revert [17].
- **Reliability (practitioner report).**
  - "The same prompt can produce different results on different runs."
  - The agent ignores the linked design system unless told: "Every time."
  - Figma advises testing skills on a duplicate file first [15].
- **Make.** A real React/TSX app (`App.tsx` plus files). Users can edit files in a code editor next to the chat, but **cannot create files manually**; only the AI can [17]. That is a small, deliberate parity gap.
- **Annotations.**
  - The Figma agent can summarise comment threads into next steps [12].
  - The MCP tool list has **no comment tools** [10].
  - FigJam stickies created through `use_figma` get `authorName` = the current human user, and the skill says to keep the author visible [14]. So AI-made stickies are attributed to the human, which is an attribution gap.
- **Collaboration.** Agent chats are shared with teammates by default [13].

### 1.4 tldraw: Make Real, the agent starter kit, Fairies, tldraw offline, comments

The most transparent engineering record of the set, and the most relevant.

- **Make Real (2023).** Render the selection to PNG, send it to a vision model, return a single HTML file, and drop it back on the canvas as an iframe shape. Users annotate the result and run it again [23]. This is a vision loop, not structured editing.
- **Agent starter kit.**
  - The model sees a screenshot plus simplified shapes:
    - `BlurryShape` for shapes in the viewport;
    - `FocusedShape` for full properties, also used for creation;
    - `PeripheralShapeCluster` for off-screen shapes, as counts and bounds [18].
  - Actions are Zod schemas, each with a `_type`, and stream in incrementally.
  - `sanitizeAction()` repairs model mistakes such as nonexistent or duplicate IDs and bad coordinates before an action is applied or saved to history [18][19].
  - **Modes** restrict what the agent can see and do (`working` mode has "full access to the canvas"). Agents can schedule follow-ups or interrupt [18].
  - It is one `TldrawAgent`, not many [18].
- **Fairies (December 2025).**
  - Several visible, embodied agents on one canvas. "They divide work, react to each other, and signal status" [20].
  - A summary of a talk says one fairy acted as orchestrator: it assigned tasks, waited for peers, and reviewed their outputs. Task status was drawn *on the canvas* instead of in chat logs [24, secondary].
  - Deliberately limited: browser-only, no filesystem, web search or MCP, and suited to short tasks only [20].
  - A GitHub issue proposed removing fairies from tldraw.com; whether that happened is unconfirmed [search result].
- **Pivot: tldraw offline (2026).**
  - A local app working on local `.tldraw` files that bundle canvas data, assets and scripts [22].
  - Local coding agents (Claude Code, Codex) connect through a port that "could accept raw JavaScript and run it directly, in context" [22].
  - Why the move: discrete actions were "severely limiting", and code reduces tokens and latency. Agents "reason and plan well when they write code" [20].
  - Context is **pulled, not pushed**: canvas context sits behind tool calls, with an overview like "a repo map" [20].
  - A **canvas linter** warns the agent about layout problems such as overlapping text [20].
  - On safety: running AI code is acceptable offline because without a server the risk "mostly disappears"; online, output goes through a constrained schema [22].
- **Comments, "Agents can't point" (SDK 5.3, `@tldraw/commenting`).**
  - Agent notes and shapes were "anonymous", cluttered the canvas, and couldn't be threaded.
  - Comments are a separate record that "sits parallel to the canvas and pointing into it". Pins anchor to shapes, which solves deictic references ("this, here").
  - Agents use **the same comment tools as people**: @-mention the agent and it replies in the thread. Comments also serve as a coordination surface between multiple agents [21].
- **Spatial weakness.** "Agents are really really bad at working in 2D space." Screenshots plus JSON are both needed [24, secondary].

### 1.5 Penpot

- **Format.**
  - The `.penpot` format (v3) is a ZIP of JSON (a manifest, plus per-page folders split into per-shape files) and binary assets. "You can unzip a .penpot file and read the JSON" [27].
  - The old SVG+JSON export is deprecated (2.3 and earlier) [27].
  - The live document sits on the server, not on disk.
- **Edit path.**
  - The MCP server plus a **Penpot plugin running in the open browser tab**.
  - Tools: `execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`, `import_image` [26].
  - In other words, code execution against the open plugin API, the same pattern as `use_figma`.
  - It acts only on the focused page, and only one tab can own MCP at a time [26].
- **Safety.**
  - No undo is documented. The advice is to start read-only, have the agent describe changes before applying them, and take small reversible steps [26].
  - A per-user MCP key works like a password [26].
- **Agents.** None of its own; it is client-agnostic (Claude, Cursor, Codex, VS Code) [26].

### 1.6 Paper (paper.design)

- **Format.** The canvas is built on HTML and CSS, which LLMs "already understand well" [28]. Storage is hosted: Paper Desktop plus a cloud file, not a repo file [28].
- **Edit path.**
  - MCP over stdio (`paper mcp`), or HTTP at `127.0.0.1:29979` [28].
  - **[secondary]** Tools [29]:
    - orientation: `get_basic_info`, `get_tree_summary`, `get_selection`, `get_node_info`;
    - creation: `find_placement`, `create_artboard`, `duplicate_nodes`;
    - editing: `write_html` (replaces a node's whole content, so target children), `update_styles`, `set_text_content`;
    - export: `get_jsx` (React+Tailwind out);
    - verification: `get_screenshot`, `get_computed_styles`.
- **Locks [secondary].**
  - `start_working_on_nodes` / `finish_working_on_nodes` are *hard* locks: the user cannot edit those nodes meanwhile. If `finish` is never called, the user stays locked out [29].
  - That is a cautionary detail for Maude's soft locks.
- **Safety.** The agent asks permission before each Paper tool call. "Always allow" is suggested for read-only tools only [28].
- **Placement helper.** `find_placement` exists so the model doesn't hand-compute where a new artboard goes [29]. This lines up with Maude's `canvas-rects` geometry manifest.

### 1.7 Onlook (open source)

- **Format.** The user's own Next.js/Tailwind source on disk [30].
- **Edit path.**
  - Visual edits are first applied live to the DOM ("non-persistent until written to code").
  - They are then written back through build-time injected source-pointer attributes, the "location of the code block, and the component scope", followed by an AST parse, style injection and a file write [30].
  - Every change is stored as a serializable **action**, "groundwork for … agents generating actions" [30].
  - The AI generates and modifies code through an `ai` package on the AI SDK [30].
- **Parity.** By construction: human visual edits and AI code edits end in the same file.

### 1.8 Lovable, v0, Bolt (prompt-to-app builders)

- **Lovable [34].**
  - The project's code is synced into the browser as an AST (Babel/SWC).
  - Visual edits mutate the AST optimistically, generate Tailwind client-side, regenerate clean JSX/TSX, diff, push to the cloud and send HMR.
  - A human visual edit writes source **without an LLM call**, which is parity at zero AI cost.
- **v0 [33].**
  - Design Mode launched to make UI changes "without editing code or spending any credits", for Tailwind/shadcn only.
  - By March 2026 users reported that edits need **Apply**, which goes through chat and costs credits, and that jump-to-code had gone. There was no official answer in the thread.
  - Cautionary tale: when direct manipulation depends on the AI to persist, parity breaks and users notice.
- **Bolt [35].**
  - The model streams XML `<boltArtifact>` / `<boltAction type="file|shell">`.
  - A streaming parser runs each file write or shell command in a WebContainer as soon as its closing tag arrives.
  - It relies on a careful system prompt rather than a multi-agent loop [35, secondary analysis of a 2024 prompt].

### 1.9 Subframe and Builder.io Fusion (design-to-code with git)

- **Subframe.**
  - A visual editor over real React+Tailwind components that are synced to the repo by CLI. "All generated code lives in your codebase" [31].
  - It has an MCP and agent skills, and `design_page` generates variations that land as pages [31].
  - Vendor claim: design-system-as-context is about 20× fewer tokens than sending Figma or Paper canvases [31].
- **Builder Fusion.**
  - A branch per change set, a preview URL per PR, and "Send PR" from the visual editor [32].
  - The bot writes a plain-English summary of visual edits onto the PR. Reviewers @-mention the bot on PR lines and it applies the fix to the same PR [32].
  - Conventions come from `AGENTS.md` [32].
  - Git *is* the safety and parity layer.

### 1.10 Google Stitch

- An "AI-native infinite canvas" (March 2026 overhaul) [36].
- One **design agent** that "can reason across the entire project's evolution", plus an **Agent Manager** to "work on multiple ideas in parallel" [36]. That is parallel *variants*, not role specialists.
- `DESIGN.md` is an "agent-friendly markdown file" to export and import design rules to and from other tools [36]. It is a files-as-API move for design-system context.
- Code reaches outside tools through an MCP server and SDK [36].

### 1.11 Framer

- **No separate MCP server.**
  - `npx @framer/agent setup` installs **skills** into the agent's folders. Any agent that can "run a terminal command or call an MCP tool" connects [37].
  - This is skills plus CLI, structurally the same as Maude's A13 (b).
- **Safety.** "Every change from an external agent is made on a branch". You review, undo, and merge into main. Agents edit the canvas, not the live site, and publish only when told [37].
- **Scope.** Access is limited to explicitly connected projects, with no account or billing access, and is revocable [37].
- **Agents.** There is an internal agent as well; external agents are pitched as having "deeper capabilities, custom skills" [37]. That is not parity *between agents*, but both write the same canvas.

### 1.12 Webflow

- The MCP server's Designer tools work through a **Bridge App running inside the open Designer** [38]. That is the same plugin-in-the-tab pattern as Penpot.
- Its connection is lost when the Designer closes [38]. The remote setup is flagged experimental [38].
- **[observed]** A Webflow MCP connector available in this environment lists tools such as:
  - `designer_tool`, `data_element_builder`, `data_whtml_builder` (HTML in, elements out);
  - `element_snapshot_tool`, `data_comments_tool`, `ask_webflow_ai`.
  - So: structured ops, plus an HTML-to-elements bulk path, plus comments. Tool names only; behaviour not tested.

### 1.13 Canva

- **Format.** Proprietary and server-side.
- **Edit path.** The official MCP / AI Connector covers generation, "targeted modifications … through natural language commands", brand kits, export, and adding comments [39].
- **Transactions.**
  - `start-editing-transaction` returns a transaction ID and the editable `element_ids`; then `perform-editing-operations`; then `commit-editing-transaction`. "Edits stay in draft until commit." [39]
  - If a human edits the design meanwhile, the commit fails because the snapshot is stale. The fix is cancel, start a new transaction, re-apply, commit [39].
  - This is the clearest example in the market of **optimistic concurrency between people and AI**.

### 1.14 Miro (Sidekicks, MCP) and Uizard

- **MCP.**
  - More than 16M calls since February 2026; Claude Desktop and Claude Code made up 65% of August usage [40].
  - 57% of calls are *board to code* (an agent reads a board and acts on it); 41% are *code to board* (agents generate diagrams and layouts) [40].
  - Reading annotated boards is the dominant agent use.
- **Sidekicks.**
  - "Conversational AI agents that work with your team on the canvas". "AI can see anything you select" [40].
  - The early set was **persona-specialised** (Product Leader, Agile Coach, Product Marketer) and gave domain feedback "like any other team member" [40, Computerworld via search].
  - The current page talks about agents customised with brand guidelines and frameworks, where "every step plays out on the canvas" [40].
  - **Flows** are visual AI pipelines, for example stickies into slides [40].
- **Uizard.** Acquired by Miro in mid-2024 (screenshot or sketch to mockup) [42]. No current architecture detail found.

### 1.15 Excalidraw

- **Format.** `.excalidraw` JSON scenes.
- **Excalidraw+ AI.** "Generate a diagram from a sentence, paste Mermaid, or let an agent do it" [41].
- **Mermaid as the intermediate representation.** Mermaid conversion is deterministic and unlimited. The open-source `mermaid-to-excalidraw` renders Mermaid to SVG for positions, then maps it to native shapes [41].
- An API and MCP integration is in public beta [41]. Many community MCP servers use the same approach (`create_from_mermaid`) [41].
- **Pattern.** Let the model write a compact text DSL; a deterministic layout engine owns the geometry. This sidesteps the 2D weakness.

### 1.16 Notion, Visily, and others

I did not research these deeply enough to make architectural claims. They are omitted on purpose.

---

## 2. Comparison matrix

| Tool | Document substrate | On disk / human-readable | AI write path | Agent topology | Reversibility & concurrency |
|---|---|---|---|---|---|
| Claude Design | HTML + inline JSX files [4 unverified] | Hosted project files; export HTML | Generic file tools + `str_replace` [4] | 1 agent + verifier subagent [4] | File copies; org sharing; group chat [4][5] |
| Pencil | `.pen` JSON | Yes, git | MCP batch ops (`batch_design`) + CLI; "don't edit the JSON" [7][8] | User's agent | Git; recovery backup [7] |
| Figma (MCP) | Server scene graph | No (XML / screenshots for reading) | JS against the Plugin API (`use_figma`) [9] | User's agent + skills | Atomic scripts [14]; one-turn undo; whole-file restore [16] |
| Figma agent | same | No | Native, fine-tuned [12] | 1 agent + skills; parallel prompts [12][13] | as above; shared chats [13] |
| Figma Make | React TSX files | In-app code editor | AI writes files; humans edit but can't create files [17] | 1 agent | Checkpoint per turn [17] |
| tldraw kit | Store records | `.tldr` JSON | Zod-typed actions + sanitize [18] | 1 agent, modes | History via editor |
| tldraw offline | `.tldraw` local file [22] | Yes, local | Raw JS against the `Editor` [22] | User's coding agent | Local, no server [22] |
| tldraw Fairies | Store | – | Discrete actions [20] | Multi-agent, orchestrator [24] | Short tasks; canvas only [20] |
| Penpot | Server; `.penpot` = ZIP + JSON [27] | Export only | `execute_code` via an in-tab plugin [26] | User's agent | Describe-then-apply advice [26] |
| Paper | HTML / CSS | Hosted | ~24 granular MCP tools [29] | User's agent | Hard node locks; per-call permission [28][29] |
| Onlook | User's React source | Yes | AST write-back; serializable actions [30] | 1 agent | Git |
| Lovable | User's React source | Yes (git sync) | AST in browser for visual edits; AI for code [34] | 1 agent | Versions / git |
| v0 | React source | Yes | Chat; design-mode "Apply" via AI [33] | 1 agent | Versions |
| Bolt | Files in a WebContainer | Yes | Streamed XML file / shell actions [35] | 1 agent | – |
| Subframe | React + Tailwind (CLI sync) | Yes | MCP + skills [31] | User's agent | Git |
| Builder Fusion | User's repo | Yes | Agent on a branch; PR bot [32] | 1 agent + PR-review loop | Branch / PR per change [32] |
| Stitch | Hosted canvas; `DESIGN.md` | `DESIGN.md` only | Native agent; MCP out [36] | 1 agent + parallel ideas [36] | – |
| Framer | Hosted canvas | No | Skills + CLI agent bridge [37] | Internal + external agents | Branch per agent change [37] |
| Webflow | Hosted | No | MCP via an in-Designer bridge [38] | User's agent | – |
| Canva | Hosted | No | MCP with editing transactions [39] | User's agent | Draft → commit; stale snapshot → retry [39] |
| Miro | Hosted board | No | MCP; Sidekicks [40] | Persona sidekicks + flows | Enterprise controls [40] |
| Excalidraw+ | `.excalidraw` JSON | Yes | Text → Mermaid → deterministic layout [41] | 1 call / agent | – |

---

## 3. Recurring patterns

### P1. "Code mode" beats granular tools

- Figma (`use_figma`), Penpot (`execute_code`) and tldraw offline (a raw-JS port) all expose *one* code-execution surface over the document's API rather than dozens of verbs [9][20][22][26].
- tldraw states the reason directly: discrete actions were "severely limiting", and code cuts tokens and latency and lets the model plan [20].
- Anthropic's MCP guidance generalises it: code over tools took one workflow from 150k to 2k tokens, with progressive disclosure and filtering in the execution environment [45].
- The tools with many granular verbs (Paper about 24, Pencil batch ops, Canva transactions) are the ones whose substrate the model cannot touch directly.

### P2. Readable substrate gives parity for free; opaque substrate forces an API, and parity becomes a roadmap item

- Figma has to say "working toward parity with the Plugin API" [11].
- Onlook and Lovable get parity by writing human visual edits back to the same source the AI edits [30][34].
- Claude Design's `EDITMODE` blocks are rewritten on disk by the host [4, unverified].

### P3. Raw writes are wrapped by invariant guards outside the model

The guards seen so far:

- atomic scripts (Figma [14]);
- action sanitizing (tldraw [18]);
- "use the app, CLI or MCP, not raw JSON" (Pencil [7]);
- transactions with stale-snapshot rejection (Canva [39]);
- node locks (Paper [29]);
- branches (Framer, Builder [32][37]).

Nobody trusts the raw write. The guard sits in the harness.

### P4. Incremental, verified writes

Every serious skill or guide says roughly the same thing:

- small steps (Figma, and Pencil's at most about 25 operations);
- return IDs;
- check structure (`get_metadata`, `snapshot_layout`, layout lint);
- then screenshot [8][14][20].

The geometry check and the visual check are separate tools.

### P5. Geometry is outsourced

Models are bad at 2D layout [24]. Tools give them:

- placement helpers (Paper `find_placement` [29]);
- bounding-box snapshots (Pencil [8]);
- layout linting (tldraw [20]);
- a deterministic layout engine behind a text DSL (Excalidraw and Figma via Mermaid [10][41]).

### P6. The agent's feedback goes in comments; its content goes on the canvas

- tldraw's shift from notes to comments [21].
- Claude Design's comment batches [6].
- The Figma agent summarising comments [12].
- Canva and Webflow expose comment tools [38][39].

Attribution is still weak: Figma stickies created by the agent carry the human's name [14].

### P7. Undo granularity is the weakest link everywhere

- Figma: one agent turn undoable, then whole-file restore [16].
- Figma Make: per-turn checkpoints [17].
- Claude Design: file copies [4].

Branch-per-agent-change (Framer, Builder) is the most robust model shipped so far.

### P8. One general agent plus skills is the dominant topology

- Figma [11][14], Framer [37], Stitch [36], Claude Design (plus a verifier) [4].
- Most others drive the *user's* single coding agent (Pencil, Paper, Penpot, Subframe, Webflow, Canva).
- Specialization lives in **skills and reference files** (Figma's FigJam references per node type [14]), or in **personas for feedback** (Miro [40]).

---

## 4. Trade-offs: files-as-API vs MCP or structured ops vs code mode

| | Files as API (Maude A13, Claude Design [4], Onlook, Lovable) | Structured ops / MCP verbs (Paper, Pencil, Canva) | Code mode over an editor API (Figma, Penpot, tldraw offline) |
|---|---|---|---|
| Model fluency | Highest when the format is JSX / HTML the model already knows | Needs schemas; many verbs eat context [45] | High (JS) but needs API docs on demand [20] |
| Token cost | Low for targeted `str_replace`; high if whole files are re-read | Tool-definition overhead [45] | Low [20][45] |
| Invariants (IDs, schema, geometry) | **Not enforced by default.** Needs hooks, validators, a watcher | Enforced per verb | Enforced by the API; atomic [14] |
| Concurrency with humans | Needs file-level leases or merge | Transactions and locks possible [29][39] | Live editor and CRDT |
| Review and diff | Git diffs readable, which is a big win | Opaque | Opaque |
| Portability across agents | Any agent with file tools | Any MCP client | Any client with the tool |
| Failure mode | Silent schema drift, broken IDs, bad coordinates | Verb gaps (parity lags) | Partial-intent scripts; sandbox risk [22] |

For a **local, human-readable JSX canvas** edited by Claude Code, files-as-API is the right default. It is already the "code mode" that others built bridges to reach, and git gives diffs and history for free.

The evidence says it needs three compensating mechanisms:

1. **Deterministic guards after each write.** A PostToolUse validator covering:
   - JSON-schema validation of `.meta.json` and `.annotations.json`;
   - element-ID preservation;
   - artboard IDs referenced by annotations still existing;
   - no overlapping artboards.

   Repair or reject, as tldraw's `sanitizeAction` does [18], and atomic, as Figma does [14]. This is A13's `edit.touched` plus schema checks.
2. **Geometry helpers as CLI verbs, not hand-computed coordinates.** Maude already has `canvas-rects`, `annotate --pin/--board` and `read-annotations --rects`.
   - Add a **placement verb**: "find free space near artboard X", in the spirit of Paper's `find_placement` [29].
   - Add a **layout lint**: overlaps and clipped text, in the spirit of tldraw [20] and Pencil's `snapshot_layout` [8].
   - Both fit A13 (b).
3. **Human-edit to file round-trip without the LLM**, as Lovable [34] and Onlook [30] do, and as Claude Design's `EDITMODE` [4] appears to. Every direct manipulation in the studio must write the file deterministically. v0's "Apply costs credits" is the anti-pattern [33].

When would an MCP or ops layer be worth it? **[speculation]**

- Only when a non-file actor needs transactional guarantees: a cloud agent writing while a human edits the same artboard live.
- Canva's start/commit/stale-retry [39] is the model to copy *inside* a CLI verb if that ever becomes necessary. It does not need a second protocol.

---

## 5. Specialized agents: where they pay off and where they hurt

### Evidence

- **Cognition (2025):** "Don't build multi-agents". Parallel subagents make conflicting implicit decisions, so share context. **Cognition (April 2026) follow-up** [43]:
  - What works: *writes stay single-threaded* while extra agents add intelligence.
  - Generator–reviewer loops work best when the reviewer has **clean context** (the diff only).
  - Read-only subagents are established practice.
  - Manager–child delegation is still rough: children don't report back by default and assume shared state.
- **Anthropic multi-agent research** [44]:
  - Multi-agent systems use about 15× the tokens of chat.
  - They are a poor fit where agents "share the same context" or have many dependencies.
  - "Most coding tasks involve fewer truly parallelizable tasks than research."
  - Subagents should write outputs to the filesystem and return references, which avoids the "game of telephone".
- **LangChain** (via search summary): read-heavy multi-agent systems are easier than write-heavy ones [47].
- **Claude Code subagents** [46]:
  - Each subagent has its own context window and starts fresh.
  - They are good for side tasks that would "flood your main conversation".
  - `AskUserQuestion` is removed from subagents, so they cannot ask the user mid-task. That matters in an in-app chat.
  - Each subagent counts toward the same usage limits.
- **In design tools:**
  - tldraw ran the only genuine multi-agent canvas: an orchestrator plus workers with visible on-canvas status [20][24]. It kept it short-task and on-canvas, then put its effort into a single local coding agent with code mode [20][22].
  - Figma, Framer and Stitch use one agent plus skills. Stitch's parallelism is *parallel ideas* [36].
  - Claude Design's only subagent is a verifier [4].
  - Miro's specialists are perspective personas [40].

### Applied to Maude's question: an artboard agent and an annotation agent

**Specialized artboard-writer agents running alongside the main agent.** Mostly hurts.

- Artboards on one canvas share the design system, the shell, the copy voice and inter-artboard flow. That is exactly the "shared context, many dependencies" case [44] and Cognition's conflicting-implicit-decisions case [43].
- They also cost about 15× tokens [44] and cannot ask the user questions in the chat [46].
- **Exception, map-reduce variants.** "Give me 4 directions for the hero" means each subagent owns a *disjoint* new artboard or file under A13's one-AI-per-artboard lease. The lead gives a tight brief (objective, output format, boundaries [44]) and picks the winner. Stitch's parallel ideas [36] and Figma's parallel prompts [12] are the product precedents. Writes stay disjoint, so the single-writer rule holds per artboard.

**A specialized annotation or whiteboard agent.** As a writer, it hurts. As a reader, it helps.

- **Writing annotations** depends on artboard geometry and element IDs the main agent just changed. Splitting it out loses that context and creates ordering races (annotation pinned to an element that is about to be renamed). Figma's answer for the same domain is **one agent plus a FigJam skill with per-element reference files** (sticky, section, connector, positioning, board planning) [14]. Maude already has `design:whiteboard` and `design:board`. Keep that shape and invest in the geometry verbs (§4.2), not in a new agent.
- **Reading a big annotated board** ("turn this retro or this sticky cloud into a brief") is a good subagent job:
  - read-only, context-heavy input, compact structured output;
  - writes a brief file and returns its path [44];
  - this is the dominant agent use on Miro (57% board-to-code [40]).

**Critics.** These are where specialization *does* pay: clean-context reviewers [43]. Two cautions from the evidence:

- **Merge their output deterministically.** Maude's reduce pass exists for this.
- **Cap how many run per edit.** The cost scales linearly [44].

A reviewer that sees only the diff and screenshots matches Cognition's best case [43]. **[speculation]** A dozen critics on every edit probably goes past the point of diminishing returns. Routing by what changed (already in Maude) is the right lever.

**draw-agent.** Justified. It is a closed loop with its own tools, rubric and deterministic engine, and it outputs a file artifact plus a verdict. That is the "subagent writes to filesystem, returns a reference" pattern [44], and the deterministic geometry engine is the same move as Excalidraw's Mermaid layout [41].

### Rule of thumb for Maude

Specialize by **skill** (knowledge loaded into the one writer). Spawn an **agent** only when one of these holds:

- (1) a clean-context review is needed;
- (2) the input is large and read-only, and the output small;
- (3) parallel writes are provably disjoint (one artboard or file each, under a lease);
- (4) a closed generate–verify loop produces a file.

Never run two agents writing the same artboard or the same `.annotations.json` concurrently.

---

## 6. Concrete recommendations for Maude v2 (A13 and V2-1.11)

1. **Confirm A13 (files are the API).** The evidence supports it.
   - Competitors built JS bridges (Figma, Penpot, tldraw) to reach what Maude has natively.
   - Anthropic's own Claude Design appears to be built on generic file tools over HTML and JSX files [4, unverified].
   - Pencil, the closest local-file analogue, still felt it had to warn against raw JSON edits [7]. So the guards are mandatory, not optional.
2. **Treat the hooks as Maude's "transaction layer".**
   - PreToolUse `edit.check`: lease, scope, trash-not-rm.
   - PostToolUse `edit.touched`: schema validation, element-ID diff, annotation-anchor integrity, "Made by AI" stamp.
   - Make the check **atomic in effect**: on validation failure, restore the pre-edit snapshot and return the error to the model, the way Figma's atomic scripts work [14]. Don't leave a half-valid file on disk.
3. **Soft locks with leases, not hard locks.**
   - Paper's hard locks can strand the user if `finish` is never called [29].
   - Use a TTL lease released by the Stop hook, and let the human take over immediately; the AI's next write then fails the check. That is Canva's stale-snapshot semantics [39].
4. **One AI run = one undo step, plus per-turn checkpoints.** This is better than Figma's agent, which offers one-turn undo and then whole-file restore, prompting complaints about lost work [16]. Consider an optional "AI changes land on a git branch or worktree" mode for bigger runs, following Framer and Builder [32][37].
5. **Separate AI feedback from AI content.**
   - Critic findings and "I changed X because Y" should go into comments, which are threaded, attributed, resolvable and anchored to an element or artboard, per tldraw's experience [21].
   - Stickies are for content the user asked for.
   - Stamp AI authorship on both, closing the gap Figma has where AI stickies carry the human's name [14].
   - Let the user batch-send selected comments to Claude, as Claude Design does [6].
6. **Geometry verbs over coordinates.** Add or confirm in the CLI:
   - `place` (find free space near an anchor);
   - `layout-lint` (overlaps and clipping on artboards and annotations);
   - `canvas-rects` as the read side.

   For diagram-like annotations, consider a text DSL with deterministic layout, as with Mermaid in Excalidraw and Figma [10][41].
7. **Context: pull, don't push.** Give the agent an overview manifest (artboard list, sizes, annotation counts per artboard) and fetch details on demand, following tldraw's "repo map" approach [20]. Don't preload whole `.annotations.json` files.
8. **Human direct manipulation never routes through the LLM.** Every studio gesture writes the file deterministically. Use the AI only for intent [30][33][34].
9. **Skill layout mirrors Figma's FigJam skill.**
   - One `whiteboard` skill with per-element references (sticky, arrow or connector, section, sticker, vote), plus a `plan-board-content` reference [14].
   - Rather than an annotation agent.
   - Add one read-only `board-digest` subagent if large boards become common.

---

## 7. Explicit speculation and open questions

- Claude Design internals (file tools, `EDITMODE`, the verifier subagent) come from an **unofficial leaked prompt** [4]. Treat them as plausible, not confirmed.
- Pencil's encryption question is unresolved: the core-concepts page now 404s, while the `.pen` page says plain JSON [7].
- Paper's tool list and the lock semantics are from community skill docs [29], not official reference.
- tldraw Fairies' orchestrator details come from a talk summary [24]. The official post does not discuss coordination failures [20].
- No vendor published quantitative data comparing single and multi-agent quality *for design editing*. The multi-agent evidence (§5) is from coding and research domains and is extrapolated here.

---

## Sources

1. Anthropic — Introducing Claude Design by Anthropic Labs. https://www.anthropic.com/news/claude-design-anthropic-labs
2. Claude blog — Claude Design now stays on brand for daily work (June 2026). https://claude.com/blog/claude-design-stays-on-brand-for-daily-work
3. Gigazine — Claude Design × Claude Code (2026-06-18). http://gigazine.net/gsc_news/en/20260618-claude-design-claude-code
4. **[unverified]** "claude design system prompt" gist (hqman). https://gist.github.com/hqman/f46d5479a5b663c282c94faa8be866de
5. Claude Help Center — Set up your design system in Claude Design. https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design
6. **[secondary]** AI For Developers — How to Actually Use Claude Design. https://aifordevelopers.substack.com/p/how-to-actually-use-claude-design
7. Pencil docs — .pen files. https://docs.pencil.dev/core-concepts/pen-files
8. **[secondary]** azukiazusa — New design tool Pencil. https://azukiazusa.dev/en/blog/new-design-tool-pencil ; Playbooks pencil-basics skill. https://playbooks.com/skills/gyejoon/pencil-plugin/pencil-basics ; Classmethod — Claude Code + Pencil MCP. https://dev.classmethod.jp/en/articles/claude-code-pencil-mcp-web-design/
9. Figma developer docs — Write to canvas (`use_figma`). https://developers.figma.com/docs/figma-mcp-server/write-to-canvas
10. Figma developer docs — Tools and prompts. https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
11. Figma blog — Agents, meet the Figma canvas (2026-03-24). https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/
12. Figma blog — The Figma agent is here. https://www.figma.com/blog/the-figma-agent-is-here/
13. Figma forum — Everything announced at Config 2026. https://forum.figma.com/product-updates-3/everything-announced-at-config-2026-55221
14. Figma official Claude Code plugin skills `figma-use` and `figma-use-figjam` (plugin v2.2.95, claude-plugins-official marketplace; read from local plugin cache `~/.claude/plugins/cache/claude-plugins-official/figma/2.2.95/skills/`).
15. **[secondary]** Bitovi — Figma just opened the canvas to agents: here's what actually happens. https://bitovi.com/blog/figma-just-opened-the-canvas-to-agents.-heres-what-actually-happens
16. Figma Help — View a file's version history. https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history ; Figma forum — I lost work with Figma AI Agents. https://forum.figma.com/report-a-problem-6/i-lost-work-with-figma-ai-agents-58673
17. Figma Help — Figma Make code editing. https://help.figma.com/hc/en-us/articles/33649966245783 ; Figma developer docs — Iterate your code with AI. https://developers.figma.com/docs/code/iterate-your-code-with-ai
18. tldraw — Agent starter kit. https://tldraw.dev/starter-kits/agent
19. tldraw — AI integrations docs. https://tldraw.dev/docs/ai
20. tldraw blog — How we built a spatial harness for agents on the canvas. https://tldraw.dev/blog/harnessing-the-agents
21. tldraw blog — Agents can't point. https://tldraw.dev/blog/agents-cant-point
22. tldraw blog — Introducing tldraw offline. https://tldraw.dev/blog/tldraw-offline
23. tldraw blog — Make Real, the story so far. https://tldraw.dev/blog/make-real-the-story-so-far
24. **[secondary]** Sean Weldon — summary of "The Spatial Harness" (Max Drake, tldraw). https://www.sean-weldon.com/blog/2026-09-11-the-spatial-harness-bringing-agents-to-the-canvas-max-drake-tldraw ; fairies site https://fairies.tldraw.com/ ; GitHub issue #7808 https://github.com/tldraw/tldraw/issues/7808
25. (reserved)
26. Penpot Help — MCP server. https://help.penpot.app/mcp/ ; Penpot — MCP server product page. https://penpot.app/ai/mcp-server
27. Penpot — .penpot file format (technical guide + user guide). https://help.penpot.app/technical-guide/developer/data-model/penpot-file-format/ ; https://help.penpot.app/user-guide/export-import/penpot-file-format/
28. Paper docs — MCP. https://paper.design/docs/mcp
29. **[secondary]** paper-design community skill (tool list, locks). https://skills.sh/tdimino/claude-code-minoan/paper-design ; Banani — Paper.design review. https://www.banani.co/blog/paper-design-mcp-review
30. Onlook docs — Architecture. https://docs.onlook.com/developers/architecture
31. **[secondary]** Banani — Subframe review. https://banani.co/blog/subframe-ai-review ; Subframe — Subframe vs Paper. https://www.subframe.com/tips/subframe-vs-paper
32. Builder.io — Introducing Fusion. https://site.builder.io/blog/introducing-fusion ; Git branching for designers. https://builder.io/blog/git-branching-for-designers ; Git providers docs. https://www.builder.io/c/docs/projects-git-providers
33. Vercel community — Introducing Design Mode on v0. https://community.vercel.com/t/introducing-design-mode-on-v0/13225 ; New Design Mode: why do simple edits now require AI credits? https://community.vercel.com/t/new-design-mode-why-do-simple-edits-now-require-ai-credits/44083 ; How to save and persist edits in v0 design mode. https://community.vercel.com/t/how-to-save-and-persist-edits-in-v0-design-mode/36625
34. Lovable blog — Visual edits. https://lovable.dev/en/blog/visual-edits
35. **[secondary]** Bolt.new system prompt gist (2024). https://gist.github.com/curran/753aa62fd99b7df8f858743d605f1d02 ; repo https://github.com/stackblitz/bolt.new
36. Google — Introducing "vibe design" with Stitch (2026-03-18). https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/
37. Framer — Connect Framer to Claude, Codex, Cursor (external agents). https://www.framer.com/agents/external/ ; Framer AI designer. https://framer.com/solutions/ai-designer/
38. Webflow developers — MCP server and AI tools. https://developers.webflow.com/data/v2.0.0/docs/ai-tools ; https://github.com/Webflow/mcp-server
39. Canva developers — MCP. https://canva.dev/docs/mcp/ ; commit-editing-transaction. https://www.canva.dev/docs/mcp/tools/commit-editing-transaction/ ; Verify your Canva MCP integration. https://www.canva.dev/docs/mcp/verify-integration/
40. Miro newsroom — Momentum grows for Miro MCP (2026-09-29). https://miro.com/newsroom/momentum-grows-for-miro-mcp-as-users-embrace-the-canvas-for-ai-collaboration/ ; Miro — Sidekicks. https://miro.com/ai/sidekicks/ ; Miro — What's new October 2025. https://miro.com/blog/whats-new-october-2025/ ; Computerworld — Miro launches Intelligent Canvas. https://www.computerworld.com/article/3476030/
41. Excalidraw+ — AI. https://plus.excalidraw.com/ai ; mermaid-to-excalidraw. https://github.com/excalidraw/mermaid-to-excalidraw ; Excalidraw+ changelog. https://plus.excalidraw.com/changelog
42. Dealroom — Miro acquires Uizard. https://ai-startups.dealroom.co/news/feed/miro-acquires-uizard-expands-design-tools
43. Cognition — Don't Build Multi-Agents (2025). https://cognition.com/blog/dont-build-multi-agents ; Multi-Agents: What's Actually Working (2026). https://cognition.com/blog/multi-agents-working
44. Anthropic Engineering — How we built our multi-agent research system. https://www.anthropic.com/engineering/multi-agent-research-system
45. Anthropic Engineering — Code execution with MCP. https://www.anthropic.com/engineering/code-execution-with-mcp
46. Claude Code docs — Subagents. https://code.claude.com/docs/en/sub-agents
47. **[secondary, search summary]** LangChain — How and when to build multi-agent systems. https://blog.langchain.com/how-and-when-to-build-multi-agent-systems
