// P8 r11 (03 `ai-long-pinned`): under "Six shots picked …" the board draws the shots themselves, six small thumbnails.
// The data is the turn's own tool calls — the raster files the reply put into (or named inside) the design root —
// never anything invented: a reply whose calls name fewer than two served pictures draws no strip.
import { describe, expect, test } from 'bun:test';

import { pickedShots, SHOTS_MAX } from '../client/v2/ai/picked-shots.js';

const call = (toolName: string, args: Record<string, unknown>) => ({
  type: 'tool-call',
  toolCallId: `t-${Math.random()}`,
  toolName,
  args,
});
const P = '/Users/x/proj/.design/assets/combine-recap';

describe('the shots a reply picked', () => {
  test('a Write per picture gives one served tile each, in order', () => {
    const parts = [1, 2, 3].map((n) => call('Write', { file_path: `${P}/shot-0${n}.jpg` }));
    expect(pickedShots(parts, '.design')).toEqual([
      { name: 'shot-01.jpg', src: '/.design/assets/combine-recap/shot-01.jpg' },
      { name: 'shot-02.jpg', src: '/.design/assets/combine-recap/shot-02.jpg' },
      { name: 'shot-03.jpg', src: '/.design/assets/combine-recap/shot-03.jpg' },
    ]);
  });

  test('a cp / mv command names its destinations, quoted or not', () => {
    const parts = [
      call('Bash', {
        command: `cp /Users/x/fotky/a.jpg "${P}/a.jpg" && mv '/Users/x/fotky/b.png' ${P}/b.png`,
      }),
    ];
    expect(pickedShots(parts, '.design').map((s) => s.name)).toEqual(['a.jpg', 'b.png']);
  });

  test('a Read is looking, not picking', () => {
    const parts = [1, 2, 3].map((n) => call('Read', { file_path: `${P}/shot-0${n}.jpg` }));
    expect(pickedShots(parts, '.design')).toEqual([]);
  });

  test('one picture is an edit, not a pick: no strip', () => {
    expect(pickedShots([call('Write', { file_path: `${P}/only.jpg` })], '.design')).toEqual([]);
  });

  test('files outside the design root cannot be served, so they draw no tile', () => {
    const parts = [
      call('Bash', { command: 'cp /Users/x/fotky/a.jpg /Users/x/fotky/b.jpg' }),
      call('Write', { file_path: `${P}/c.jpg` }),
    ];
    expect(pickedShots(parts, '.design')).toEqual([]);
  });

  test('a picture named twice is one tile; at most six', () => {
    const parts = [
      call('Write', { file_path: `${P}/a.jpg` }),
      call('Write', { file_path: `${P}/a.jpg` }),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => call('Write', { file_path: `${P}/s${n}.jpg` })),
    ];
    const out = pickedShots(parts, '.design');
    expect(out.length).toBe(SHOTS_MAX);
    expect(new Set(out.map((s) => s.name)).size).toBe(SHOTS_MAX);
  });

  test('text parts, a missing list and a path with .. are ignored', () => {
    expect(pickedShots(undefined, '.design')).toEqual([]);
    const parts = [
      { type: 'text', text: `${P}/a.jpg ${P}/b.jpg` },
      call('Write', { file_path: `${P}/../../../x.jpg` }),
      call('Write', { file_path: `${P}/b.jpg` }),
    ];
    expect(pickedShots(parts, '.design')).toEqual([]);
  });
});
