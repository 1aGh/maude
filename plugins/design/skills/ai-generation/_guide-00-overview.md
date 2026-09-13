

# ai-generation — BYOK AI media generation

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Maude can **arrange, edit, and export** media; this skill is how it **creates net-new** media from the user's own provider key. The pixels/audio are produced by an external provider (this is Maude's BYOK path), localized into the content-addressed `assets/<sha8>` store, and dropped onto the canvas / into the spine. Architecture + trust boundary: **[DDR-164](../../../.ai/archive/decisions/DDR-164-byok-ai-media-generation-provider-adapter-spine.md)**.

**Load this skill whenever** the request asks to *generate / make / create* an AI **image / photo / hero / background** (v1), or — later phases — **music / sound / voice / clip / subtitles**, or when a canvas/reel has a visible media **gap** the user asks to fill.
