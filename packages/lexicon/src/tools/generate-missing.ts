import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { AI_PROMPT, AI_PROMPT_SHA256, AI_STYLE_VERSION, option, requiredOption, sha256, shardFor, stableJson } from './common.js';

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_ENTRIES = 32;
const MAX_EXAMPLES = 8;
const MAX_DEFINITION = 240;
const MAX_EXAMPLE = 180;
const SAFE_TEXT = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]*$/u;
export interface DraftEntry { ordinal: number; pos: 'n'|'v'|'a'|'s'|'r'|'other'|'unknown'; definition: string; examples: string[] }
export interface DraftRecord { schemaVersion: 1; styleVersion: string; runId: string; wordId: number; word: string; provider: string; model: string; modelRevision?: string; promptSha256: string; responseId?: string; entries: DraftEntry[] }

function safeText(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length >= 1 && value.length <= maximum && SAFE_TEXT.test(value) && value.trim() === value; }
export function validateDraft(value: unknown): DraftRecord {
  if (!value || typeof value !== 'object') throw new Error('draft must be an object'); const v = value as Record<string,unknown>;
  if (v.schemaVersion !== 1 || v.styleVersion !== AI_STYLE_VERSION || typeof v.runId !== 'string' || !Number.isInteger(v.wordId) || typeof v.word !== 'string' || !/^[a-z]+$/.test(v.word) || typeof v.provider !== 'string' || typeof v.model !== 'string' || v.promptSha256 !== AI_PROMPT_SHA256 || !Array.isArray(v.entries) || v.entries.length < 1 || v.entries.length > MAX_ENTRIES) throw new Error('invalid draft envelope');
  const validPos = new Set(['n','v','a','s','r','other','unknown']);
  v.entries.forEach((entry,index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`invalid entry ${index + 1}`);
    const e = entry as Record<string,unknown>;
    if (e.ordinal !== index + 1 || !validPos.has(String(e.pos)) || !safeText(e.definition, MAX_DEFINITION) || !Array.isArray(e.examples) || e.examples.length > MAX_EXAMPLES || !e.examples.every((x) => safeText(x, MAX_EXAMPLE))) throw new Error(`invalid entry ${index + 1}`);
  });
  return value as DraftRecord;
}

function openWork(path: string): Database.Database { const db = new Database(path); db.pragma('foreign_keys = ON'); return db; }
export function importDrafts(db: Database.Database, content: string, now = new Date().toISOString()): void {
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw new Error('draft import exceeds maximum size');
  const run = db.prepare('SELECT * FROM generation_runs').get() as {run_id:string;provider:string;model:string;model_revision:string|null;prompt_sha256:string}|undefined;
  if (!run) throw new Error('generation run is missing');
  const ingest = db.transaction((draft: DraftRecord, raw: string) => {
    if (draft.runId !== run.run_id || draft.provider !== run.provider || draft.model !== run.model || (draft.modelRevision ?? null) !== run.model_revision || draft.promptSha256 !== run.prompt_sha256) throw new Error(`generation envelope mismatch for ${draft.word}`);
    const task = db.prepare('SELECT * FROM generation_tasks WHERE run_id=? AND game_word_id=?').get(draft.runId,draft.wordId) as {normalized_word:string;attempt_count:number}|undefined;
    if (!task || task.normalized_word !== draft.word) throw new Error(`task mismatch for ${draft.word}`);
    const hash = sha256(raw); const existing = db.prepare("SELECT response_sha256 FROM generation_attempts WHERE run_id=? AND game_word_id=? AND status IN ('validated-draft','reviewed')").get(draft.runId,draft.wordId) as {response_sha256:string}|undefined;
    if (existing) { if (existing.response_sha256 !== hash) throw new Error(`conflicting validated draft for ${draft.word}`); return; }
    const info = db.prepare("INSERT INTO generation_attempts(run_id,game_word_id,attempt_number,request_started_at,request_finished_at,provider_response_id,raw_response,response_sha256,status,validation_json) VALUES (?,?,?,?,?,?,?,?, 'validated-draft',?)").run(draft.runId,draft.wordId,task.attempt_count+1,now,now,draft.responseId ?? null,raw,hash,JSON.stringify({structurallyValid:true,sourceVerified:false,humanReviewed:false,styleVersion:AI_STYLE_VERSION}));
    const addEntry = db.prepare('INSERT INTO generation_entries VALUES (?,?,?,?,?)'); for (const entry of draft.entries) addEntry.run(info.lastInsertRowid,entry.ordinal,entry.pos,entry.definition,JSON.stringify(entry.examples));
    db.prepare("UPDATE generation_tasks SET status='validated-draft',attempt_count=attempt_count+1,updated_at=? WHERE run_id=? AND game_word_id=?").run(now,draft.runId,draft.wordId);
  });
  for (const raw of content.split('\n').filter(Boolean)) { if (Buffer.byteLength(raw) > MAX_LINE_BYTES) throw new Error('draft line exceeds maximum size'); ingest(validateDraft(JSON.parse(raw)),raw); }
}

function main(): void {
  const command = process.argv[2];
  if (command === 'init') {
    const artifactPath = resolve(requiredOption('artifact')); const workPath = resolve(requiredOption('work')); const shardCount = Number(requiredOption('shards'));
    const requestedRunId = option('run-id'); const provider = requiredOption('provider'); const model = requiredOption('model');
    mkdirSync(dirname(workPath), { recursive: true }); const db = openWork(workPath);
    const initialized = db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='generation_runs'").get() as {count:number};
    const artifact = new Database(artifactPath,{readonly:true}); const metadata = Object.fromEntries((artifact.prepare('SELECT key,value FROM artifact_metadata').all() as Array<{key:string;value:string}>).map(({key,value}) => [key,value]));
    if (initialized.count) {
      const existing = db.prepare('SELECT * FROM generation_runs').get() as Record<string,unknown>;
      for (const [key,value] of Object.entries({source_artifact_version:metadata.artifact_version,wordnet_source_sha256:metadata.wordnet_source_sha256,provider,model,prompt_sha256:AI_PROMPT_SHA256,shard_count:shardCount})) if (existing[key] !== value) throw new Error(`Existing run mismatch: ${key}`);
      if (requestedRunId && existing.run_id !== requestedRunId) throw new Error('Existing run mismatch: run_id');
      artifact.close(); db.close(); console.log(JSON.stringify({runId:existing.run_id,workPath,shardCount,resumed:true})); return;
    }
    db.exec(readFileSync(new URL('../../schema/work-v1.sql', import.meta.url),'utf8'));
    const runId = requestedRunId ?? randomUUID();
    db.prepare('INSERT INTO generation_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(runId,metadata.artifact_version,metadata.wordnet_source_sha256,provider,model,option('model-revision') ?? null,AI_PROMPT_SHA256,JSON.stringify({styleVersion:AI_STYLE_VERSION,prompt:AI_PROMPT}),shardCount,new Date().toISOString());
    const insert = db.prepare("INSERT INTO generation_tasks VALUES (?,?,?,?, 'pending',0,NULL,NULL,NULL,?)");
    db.transaction(() => { for (const row of artifact.prepare('SELECT id,normalized FROM game_words WHERE id NOT IN (SELECT game_word_id FROM wordnet_senses) ORDER BY id').iterate() as Iterable<{id:number;normalized:string}>) insert.run(runId,row.id,row.normalized,shardFor(row.normalized,shardCount),new Date().toISOString()); })();
    artifact.close(); db.close(); console.log(JSON.stringify({runId,workPath,shardCount,resumed:false})); return;
  }
  if (command === 'export') {
    const db = openWork(resolve(requiredOption('work'))); const shard = Number(requiredOption('shard')); const output = resolve(requiredOption('output')); mkdirSync(dirname(output),{recursive:true});
    const run = db.prepare('SELECT * FROM generation_runs').get() as Record<string,unknown>;
    for (const task of db.prepare("SELECT game_word_id,normalized_word FROM generation_tasks WHERE shard_index=? AND status IN ('pending','retryable') ORDER BY game_word_id").iterate(shard) as Iterable<{game_word_id:number;normalized_word:string}>) appendFileSync(output,stableJson({schemaVersion:1,styleVersion:AI_STYLE_VERSION,runId:run.run_id,wordId:task.game_word_id,word:task.normalized_word,promptSha256:AI_PROMPT_SHA256,prompt:AI_PROMPT}));
    db.close(); return;
  }
  if (command === 'import') {
    const db = openWork(resolve(requiredOption('work'))); const input = resolve(requiredOption('input')); if (statSync(input).size > MAX_IMPORT_BYTES) throw new Error('draft import exceeds maximum size');
    importDrafts(db, readFileSync(input,'utf8')); db.close(); return;
  }
  throw new Error('Usage: generate-missing.ts init|export|import ...');
}
if (process.argv[1]?.endsWith('generate-missing.ts') || process.argv[1]?.endsWith('generate-missing.js')) main();
