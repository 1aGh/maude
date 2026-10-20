// S10.10 (13 · ds-edit-master): a component master edited on the Design system canvas waits as declaration
// patches (`dsPending.components[name][selector][prop]`) and Update writes them into `preview/_components.css`:
// the value is replaced inside the matching top-level rule, a declaration the rule lacks is appended to it, a
// rule the file lacks is appended at the end — and nothing else in the file moves. Driven through the real
// engine, the real kernel and a real publish.
import { afterAll, describe, expect, test } from 'bun:test';

import { cleanup, DS, DS_PATH, makeProject, PERSON } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const FILE = `${DS_PATH}/preview/_components.css`;
const edit = (selector: string, prop: string, value: string) => ({
  Button: { [selector]: { [prop]: { value } } },
});
/** A file that was already like this when the system was last published: an outside edit, kept. */
async function kept(p: Awaited<ReturnType<typeof makeProject>>, text: string) {
  await p.outside(FILE, text);
  await p.engine.keepOutside(DS, { by: PERSON });
}
const publish = async (p: Awaited<ReturnType<typeof makeProject>>) =>
  p.engine.publish(DS, { expectHead: p.engine.review(DS).expectHead, by: PERSON });

describe('component master patches reach _components.css', () => {
  test('a value is replaced inside the matching top-level rule', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, { components: edit('.btn', 'border-radius', '6px'), by: PERSON });
    expect((p.meta(`${DS_PATH}/design-system.tsx`).dsPending as { components: object }).components)
      .toMatchObject({ Button: { '.btn': { 'border-radius': { value: '6px' } } } });
    await publish(p);
    expect(p.read(FILE)).toBe('.btn {\n  border-radius: 6px;\n}\n');
  });

  test('a declaration the rule lacks is appended inside it', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, { components: edit('.btn', 'height', '40px'), by: PERSON });
    await publish(p);
    expect(p.read(FILE)).toBe('.btn {\n  border-radius: 4px;\n  height: 40px;\n}\n');
  });

  test('a rule the file lacks is appended at the end; the rest stays byte for byte', async () => {
    const p = await makeProject();
    await kept(p, '/* acme */\n.btn {\n  border-radius: 4px;\n}\n\n@media (min-width: 600px) {\n  .btn { border-radius: 2px; }\n}\n');
    await p.engine.mergePending(DS, {
      components: edit('.btn--ghost', 'background', 'transparent'),
      by: PERSON,
    });
    await publish(p);
    expect(p.read(FILE)).toBe(
      '/* acme */\n.btn {\n  border-radius: 4px;\n}\n\n@media (min-width: 600px) {\n  .btn { border-radius: 2px; }\n}\n\n.btn--ghost {\n  background: transparent;\n}\n'
    );
  });

  test('a rule inside @media is not the master rule: the top-level one is patched', async () => {
    const p = await makeProject();
    await kept(p, '.btn {\n  border-radius: 4px;\n}\n@media (min-width: 600px) {\n  .btn { border-radius: 2px; }\n}\n');
    await p.engine.mergePending(DS, { components: edit('.btn', 'border-radius', '6px'), by: PERSON });
    await publish(p);
    expect(p.read(FILE)).toBe(
      '.btn {\n  border-radius: 6px;\n}\n@media (min-width: 600px) {\n  .btn { border-radius: 2px; }\n}\n'
    );
  });

  test('a value that could leave its declaration is refused and nothing waits', async () => {
    const p = await makeProject();
    await expect(
      p.engine.mergePending(DS, {
        components: edit('.btn', 'border-radius', '6px; } body { display: none'),
        by: PERSON,
      })
    ).rejects.toMatchObject({ code: 'ds-pending-invalid' });
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
  });
});
