import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function localLexiconOptions(metaUrl, override = process.env.LEXICON_DB_PATH) {
  const scriptDir = dirname(fileURLToPath(metaUrl));
  const root = resolve(scriptDir, '..');
  const manifestPath = resolve(process.env.LEXICON_MANIFEST_PATH ?? resolve(root, 'packages/lexicon/artifacts/manifest.json'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const artifactPath = resolve(override ?? resolve(dirname(manifestPath), manifest.fileName));
  if (!existsSync(artifactPath)) throw new Error(`Lexicon artifact is missing at ${artifactPath}. Run pnpm lexicon:build.`);
  return { manifestPath, artifactPath };
}
