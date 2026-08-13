import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { option, sha256File } from './common.js';

export interface Manifest { artifactVersion:string; fileName:string; sha256:string; downloadUrl:string|null; schemaVersion:number }
export function verifyFile(path:string, expected:string): void {
  const actual=sha256File(path);
  if (actual !== expected.toLowerCase()) throw new Error(`Checksum mismatch for ${path}: expected ${expected}, got ${actual}`);
}
async function main(): Promise<void> {
  const manifestPath=resolve(option('manifest') ?? 'artifacts/manifest.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as Manifest;
  const output=resolve(option('output') ?? `artifacts/${manifest.fileName}`);
  if (existsSync(output)) { verifyFile(output,manifest.sha256); console.log(output); return; }
  if (!manifest.downloadUrl) throw new Error('No release URL is configured. Run `pnpm lexicon:build` explicitly for the unpublished local artifact.');
  mkdirSync(dirname(output),{recursive:true}); const temporary=`${output}.download`; rmSync(temporary,{force:true});
  const response=await fetch(manifest.downloadUrl); if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  await finished(Readable.fromWeb(response.body as never).pipe(createWriteStream(temporary)));
  try { verifyFile(temporary,manifest.sha256); renameSync(temporary,output); } catch(error) { rmSync(temporary,{force:true}); throw error; }
  console.log(output);
}
if (process.argv[1]?.endsWith('fetch-release.ts') || process.argv[1]?.endsWith('fetch-release.js')) await main();
