// V2-8.16 (journey S8, terminal lane) — "Bring the logo file .design/incoming/brand-mark.svg into this project's
// assets": the agent hand-cleaned the SVG and Wrote it into system/<ds>/assets/logos/, never running
// `maude design import-asset` (which sanitizes it and names it assets/<sha8>.svg). The verb was in the registry, but
// nothing taught it: the person's Assets › Add files… had no action (so no AI path), the two rows that need an import
// said only "the asset import", and the studio-actions skill's description — all an agent sees before it loads the
// skill — named no import at all.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS } from '../actions/index.ts';

const SKILL = readFileSync(
  join(import.meta.dir, '../../../plugins/design/skills/studio-actions/SKILL.md'),
  'utf8'
);
const VERB = 'maude design import-asset';

describe('V2-8.16 — bringing a file into the project is taught as `maude design import-asset`', () => {
  test('Assets › Add files… is an action whose AI path is the import verb', () => {
    const a = ACTIONS.find((x) => x.id === 'assets.add');
    expect(a?.label).toBe('Add files…');
    expect(a?.enabled).toMatchObject({ minRole: 'edit' });
    const agent = AGENT_PATHS['assets.add']?.agent as { path: string; verb?: string } | undefined;
    expect(agent?.path).toBe('cli');
    expect(agent?.verb?.startsWith(VERB)).toBe(true);
  });

  test('the rows that need an imported file name the verb', () => {
    for (const id of ['image.place', 'asset.relink']) {
      const how = (AGENT_PATHS[id]?.agent as { how?: string } | undefined)?.how ?? '';
      expect(how).toContain(VERB);
    }
  });

  test('the generated skill lists the row, and its description names the import', () => {
    expect(SKILL).toMatch(
      /\| Add files… \| `assets\.add` \| `maude design import-asset[^`]*` \| auto \|/
    );
    const description = /^description: "(.*)"$/m.exec(SKILL)?.[1] ?? '';
    expect(description).toContain(VERB);
  });
});
