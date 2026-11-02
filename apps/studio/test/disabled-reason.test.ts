// p8-dead-reasons — why a control is off, in one place (client/v2/access/disabled-reason.js).
// The words are not new copy: each line must still be said somewhere else in the studio (the surface it was
// lifted from), so a reworded source line shows up here instead of drifting apart.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  disabledReason,
  editReason,
  REASONS,
  reasonProps,
} from '../client/v2/access/disabled-reason.js';

const STUDIO = join(import.meta.dir, '..');
const tracked = Bun.spawnSync(['git', 'ls-files', 'client'], { cwd: STUDIO })
  .stdout.toString()
  .split('\n')
  .filter((f) => /\.(js|jsx|ts|tsx)$/.test(f) && !f.endsWith('disabled-reason.js'));
const elsewhere = tracked.map((f) => readFileSync(join(STUDIO, f), 'utf8')).join('\n');

describe('disabled-reason words', () => {
  test('every line is an existing line of the studio, said elsewhere too', () => {
    const missing = Object.entries(REASONS)
      .filter(([, line]) => !elsewhere.includes(line))
      .map(([k]) => k);
    expect(missing).toEqual([]);
    expect(Object.keys(REASONS).length).toBeGreaterThanOrEqual(7);
  });

  test('the viewer and Mac-app lines are the ones Michal approved', () => {
    expect(REASONS.viewer).toBe('You can view this project. Ask a project owner for edit access.');
    expect(REASONS.macApp).toBe('Open this project in the Mac app to work with its files.');
  });

  test('reasonProps says why only while the control is off', () => {
    expect(reasonProps(false, 'viewer')).toEqual({});
    expect(reasonProps(true, 'viewer')).toEqual({
      title: REASONS.viewer,
      'aria-description': REASONS.viewer,
    });
    // an existing on-screen line passes through as is; nothing to say → nothing set
    expect(reasonProps(true, 'needs Ollama')).toEqual({
      title: 'needs Ollama',
      'aria-description': 'needs Ollama',
    });
    expect(reasonProps(true, '')).toEqual({});
    expect(reasonProps(true, undefined)).toEqual({});
    expect(disabledReason('noCanvas')).toBe('Open a canvas first.');
  });

  test("the inspector's kind: the role first, else an element it cannot write", () => {
    expect(editReason({ readOnly: true })).toBe('viewer');
    expect(editReason({ readOnly: false })).toBe('cantEditHere');
    expect(editReason(null)).toBe('cantEditHere');
  });
});
