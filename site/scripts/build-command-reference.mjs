#!/usr/bin/env node
// Generate one MDX reference page per command + a grouped sidebar meta.json.
// Output lives at content/docs/commands-{flow,design}/<name>.mdx + meta.json.
// Run as a prebuild step — see site/package.json `prebuild` script.
//
// Source of truth (phase-17 Risk #1): the command catalog — which commands exist, their
// category, and the group ordering — lives in ../lib/command-catalog.mjs and is the SAME
// source the CommandTree diagram renders from. This script reads each command's .md only
// for its CONTENT (description / argument-hint / body summary), and ASSERTS that the
// catalog and the on-disk plugins/<plugin>/commands/*.md set agree — drift fails the build
// loud rather than letting the diagram silently diverge from the generated pages.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORY_ORDER,
  COMMAND_CATALOG,
  groupByCategory,
  isDaily,
} from '../lib/command-catalog.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../');
const docsRoot = resolve(__dirname, '../content/docs');
const repoUrl = 'https://github.com/1aGh/maude/blob/main';

const SOURCE_DIR = { flow: 'plugins/flow/commands', design: 'plugins/design/commands' };

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const [, yaml, body] = match;
  const frontmatter = {};
  let currentKey = null;
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      let value = kv[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        if (value.startsWith('"')) {
          try {
            value = JSON.parse(value);
          } catch {
            value = value.slice(1, -1);
          }
        } else {
          value = value.slice(1, -1);
        }
      }
      frontmatter[currentKey] = value;
    } else if (currentKey && line.startsWith(' ')) {
      frontmatter[currentKey] += ` ${line.trim()}`;
    }
  }
  return { frontmatter, body: body || '' };
}

// Escape `<` that would otherwise be parsed as JSX by MDX. Cheap & sufficient
// for auto-generated docs — we don't expect any JSX in command prompts.
function mdxEscape(text) {
  return text.replace(/</g, '&lt;');
}

function escapeYamlString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function relativeSourcePath(plugin, name) {
  return `${SOURCE_DIR[plugin.slug]}/${name}.md`;
}

/**
 * Assert the catalog ↔ on-disk .md set agree. Throws on drift so the build fails loud.
 * @returns {string[]} the sorted .md command names (file basenames sans extension)
 */
async function assertCatalogParity(plugin, sourceDir) {
  const files = (await readdir(sourceDir)).filter((f) => f.endsWith('.md'));
  const onDisk = new Set(files.map((f) => f.replace(/\.md$/, '')));
  const inCatalog = new Set(plugin.commands.map((c) => c.name));

  const missingFromCatalog = [...onDisk].filter((n) => !inCatalog.has(n)).sort();
  const missingOnDisk = [...inCatalog].filter((n) => !onDisk.has(n)).sort();

  if (missingFromCatalog.length || missingOnDisk.length) {
    const lines = [
      `[command-reference] DRIFT in ${plugin.prefix} catalog vs ${SOURCE_DIR[plugin.slug]}/:`,
    ];
    if (missingFromCatalog.length)
      lines.push(`  • on disk but NOT in command-catalog.mjs: ${missingFromCatalog.join(', ')}`);
    if (missingOnDisk.length)
      lines.push(`  • in command-catalog.mjs but NO .md on disk: ${missingOnDisk.join(', ')}`);
    lines.push(
      '  Fix site/lib/command-catalog.mjs (the single source the CommandTree diagram also reads).'
    );
    throw new Error(lines.join('\n'));
  }
  return [...onDisk].sort();
}

async function emitPlugin(plugin) {
  const sourceDir = join(repoRoot, SOURCE_DIR[plugin.slug]);
  const targetDir = join(docsRoot, `commands-${plugin.slug}`);

  // Parity assertion doubles as the existence check.
  try {
    await assertCatalogParity(plugin, sourceDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Source plugins/ tree isn't here (e.g. Vercel deploy uploads only site/).
      // The committed content/docs/commands-<slug>/ already has the last-regenerated
      // MDX; leave it alone and skip.
      console.log(
        `[command-reference] ${plugin.slug}: source ${SOURCE_DIR[plugin.slug]} not found — skipping (using committed reference)`
      );
      return 0;
    }
    throw err;
  }

  await mkdir(targetDir, { recursive: true });
  const expectedPages = new Set(plugin.commands.map(({ name }) => `${name}.mdx`));
  for (const file of await readdir(targetDir)) {
    if (file.endsWith('.mdx') && !expectedPages.has(file)) {
      await rm(join(targetDir, file));
    }
  }

  for (const command of plugin.commands) {
    const { name, category } = command;
    const raw = await readFile(join(sourceDir, `${name}.md`), 'utf8');
    const { frontmatter } = parseFrontmatter(raw);

    const description = frontmatter.description || `${plugin.prefix}${name}`;
    const argHint = frontmatter['argument-hint'] || '';
    const invocation = argHint ? `${plugin.prefix}${name} ${argHint}` : `${plugin.prefix}${name}`;
    const daily = isDaily(command);
    const sourceRel = relativeSourcePath(plugin, name);

    const mdx = `---
title: ${plugin.prefix}${name}
description: "${escapeYamlString(description)}"
---

| Property | Value |
| -------- | ----- |
| **Command** | \`${plugin.prefix}${name}\` |
| **Category** | \`${category}\`${daily ? ' (daily)' : ''} |
| **Argument hint** | ${argHint ? `\`${argHint.replace(/\|/g, '\\|')}\`` : '_(none)_'} |
| **Source** | [\`${sourceRel}\`](${repoUrl}/${sourceRel}) |

## Description

${mdxEscape(description)}

## Invocation

**Claude Code**

\`\`\`text
${invocation}
\`\`\`

**Codex**

\`\`\`text
$${plugin.slug}:source-command-${name}${argHint ? ` ${argHint}` : ''}
\`\`\`

Use the same arguments and flags. See [native Codex setup](/docs/codex) for
installation, dependencies and the distinction from Studio's built-in chat.

## Source of truth

<Callout type="note" title="Generated from frontmatter">

This page is auto-generated from the command's frontmatter. The shared workflow — including directives, edge-case handling and references loaded for each stage — starts in the source file: [**\`${sourceRel}\`**](${repoUrl}/${sourceRel}).

</Callout>
`;

    await writeFile(join(targetDir, `${name}.mdx`), mdx);
  }

  // Sidebar grouping comes from the SAME groupByCategory the CommandTree renders.
  const sidebarPages = [];
  for (const group of groupByCategory(plugin)) {
    if (sidebarPages.length || group.category !== 'daily') {
      sidebarPages.push(`---${group.category}---`);
    }
    sidebarPages.push(...group.commands);
  }

  await writeFile(
    join(targetDir, 'meta.json'),
    `${JSON.stringify({ title: `${plugin.label} commands`, pages: sidebarPages }, null, 2)}\n`
  );

  return plugin.commands.length;
}

async function main() {
  await mkdir(docsRoot, { recursive: true });
  // `CATEGORY_ORDER` is imported to keep the catalog module the single source even for
  // tooling that lints the import surface; grouping itself uses groupByCategory.
  void CATEGORY_ORDER;
  const counts = {};
  for (const plugin of COMMAND_CATALOG) {
    counts[plugin.slug] = await emitPlugin(plugin);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[command-reference] generated ${total} pages`);
}

main().catch((err) => {
  console.error('[command-reference] failed:', err);
  process.exit(1);
});
