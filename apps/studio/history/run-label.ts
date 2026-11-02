// run-label.ts — is an `ai` action's label the run's prompt? (p8-fix-d F20)
//
// A terminal AI run's prompt stays on this Mac on purpose (cli/lib/design-hook.mjs posts no label: a
// run label is shown to collaborators), so its stage is begun under a placeholder (http.ts
// `bracket.begin`). Rows already on a team server carry "Claude Code"; CONTRACT §3 says "AI". Neither
// is a prompt: Version history then titles the row by what changed, and the verb says "<person> · AI".
//
// Leaf module: no imports, erasable TypeScript only (bin/_history.mjs runs it under bun).

export const NO_PROMPT_LABELS: readonly string[] = ['Claude Code', 'AI'];

/** The run's prompt, or undefined when the label is empty or a placeholder. */
export function promptOfRun(label: string | null | undefined): string | undefined {
  if (typeof label !== 'string') return undefined;
  const t = label.trim();
  if (!t || NO_PROMPT_LABELS.includes(t)) return undefined;
  return label;
}
