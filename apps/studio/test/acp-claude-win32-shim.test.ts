// #148 — a Windows npm `claude.cmd` shim must never reach the adapter as
// CLAUDE_CODE_EXECUTABLE: Node refuses to spawn .cmd without a shell.
import { describe, expect, test } from 'bun:test';

import { resolveAgentClaudeExecutable } from '../acp/probe.ts';

const SHIM = 'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd';
const CLI = 'C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
const SHIM_TEXT =
  '@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';

const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);
const noRead = () => {
  throw new Error('unreadable');
};

describe('resolveAgentClaudeExecutable', () => {
  test('non-Windows paths pass through unchanged', () => {
    expect(resolveAgentClaudeExecutable('/usr/local/bin/claude', 'darwin')).toBe(
      '/usr/local/bin/claude'
    );
    expect(resolveAgentClaudeExecutable('/x/claude.cmd', 'linux')).toBe('/x/claude.cmd');
  });

  test('a native claude.exe on Windows passes through', () => {
    const exe = 'C:\\Users\\a\\.local\\bin\\claude.exe';
    expect(resolveAgentClaudeExecutable(exe, 'win32', only())).toBe(exe);
  });

  test('npm cmd-shim is followed to the target it names', () => {
    expect(resolveAgentClaudeExecutable(SHIM, 'win32', only(CLI), () => SHIM_TEXT)).toBe(CLI);
  });

  test('unreadable shim falls back to the conventional npm layout', () => {
    expect(resolveAgentClaudeExecutable(SHIM, 'win32', only(CLI), noRead)).toBe(CLI);
  });

  test('falls back to a claude.exe beside the shim', () => {
    const exe = 'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.exe';
    expect(resolveAgentClaudeExecutable(SHIM, 'win32', only(exe), noRead)).toBe(exe);
  });

  test('no spawnable target → null (never the shim itself)', () => {
    expect(resolveAgentClaudeExecutable(SHIM, 'win32', only(SHIM), () => SHIM_TEXT)).toBeNull();
  });
});
