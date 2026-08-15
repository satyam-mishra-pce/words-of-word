#!/usr/bin/env node
/**
 * Game-surface parity guard.
 *
 * The bug this prevents: a round feature (sounds, definitions, timer behaviour,
 * word feedback) gets built into ONE game surface (the multiplayer room) and
 * silently never reaches another (the daily run), because the two were separate
 * implementations. The permanent fix is the shared core in src/game/ that every
 * surface must consume. This script fails the build if any file that renders the
 * game round surface does NOT go through that shared core — so a new or refactored
 * surface can never ship missing a shared capability, whether written by a human
 * or an AI, and whether anyone remembers the rule or not.
 *
 * Detection is by structure, not an allow-list: any page that renders the round
 * play surface (it contains the shared surface markers below) MUST import from
 * '../game'. New surfaces are caught automatically.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const pagesDir = join(webRoot, 'src', 'pages');

// A file is a "game round surface" if it renders the shared play surface. These
// markers are the class names / entry points the round surface is built from.
const SURFACE_MARKERS = ['current-word-card', 'word-form', 'stage-notice-bar'];
// The shared core every surface must consume.
const SHARED_CORE_IMPORT = /from\s+['"][^'"]*\/game(?:\/[^'"]*)?['"]/;
// Anything that would re-introduce a private, un-shared round experience. A
// surface must emit to the shared soundBus, never trigger sounds directly.
const FORBIDDEN = [
  { pattern: /\bplayGameSound\s*\(/, hint: 'play sounds by emitting to the shared soundBus (bus.emit / bus.play), never by calling playGameSound directly' }
];

function listTsx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsx(full));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const failures = [];
for (const file of listTsx(pagesDir)) {
  const source = readFileSync(file, 'utf8');
  const isSurface = SURFACE_MARKERS.some((marker) => source.includes(marker));
  if (!isSurface) continue;

  const rel = relative(webRoot, file);
  if (!SHARED_CORE_IMPORT.test(source)) {
    failures.push(`${rel}: renders the game round surface but does not import the shared core from '../game'. Route sounds/definitions/timer/word-entry through src/game/ so every surface stays in parity.`);
  }
  for (const { pattern, hint } of FORBIDDEN) {
    if (pattern.test(source)) {
      failures.push(`${rel}: ${hint}.`);
    }
  }
}

if (failures.length > 0) {
  console.error('\n\u2716 Game-surface parity check failed:\n');
  for (const message of failures) console.error(`  - ${message}`);
  console.error('\nEvery game surface must consume the shared round core in apps/web/src/game/.');
  console.error('See AGENTS.md > "Game surface parity" for the contract.\n');
  process.exit(1);
}

console.log(`\u2714 Game-surface parity: all round surfaces consume the shared src/game core.`);
