import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, linkSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { AI_PROMPT_SHA256, requiredOption, sha256 } from './common.js';
import { validateDraft, type DraftEntry, type DraftRecord } from './generate-missing.js';
import { validateRelease } from './validate-release.js';

interface RunRow {
  run_id: string; source_artifact_version: string; wordnet_source_sha256: string;
  provider: string; model: string; model_revision: string | null; prompt_sha256: string;
  parameters_json: string; shard_count: number; created_at: string;
}
interface AcceptedAttemptRow {
  id: number; game_word_id: number; normalized_word: string; task_status: string;
  raw_response: string | null; response_sha256: string | null; attempt_status: string;
  validation_json: string | null;
}
interface StoredEntryRow { entry_ordinal: number; pos: string; definition: string; examples_json: string }
interface MergedEntry extends DraftEntry { gameWordId: number; word: string; validationJson: string }

function canonicalGeneratedHash(db: Database.Database): string {
  const hash = createHash('sha256');
  for (const row of db.prepare('SELECT game_word_id,sense_ordinal,pos,definition,examples_json,validation_json FROM generated_senses ORDER BY game_word_id,sense_ordinal').iterate() as Iterable<Record<string,unknown>>) hash.update(JSON.stringify(row)).update('\n');
  return hash.digest('hex');
}
function assertSameRun(expected: RunRow, actual: RunRow): void {
  for (const key of ['run_id','source_artifact_version','wordnet_source_sha256','provider','model','model_revision','prompt_sha256','parameters_json','shard_count'] as const) {
    if (expected[key] !== actual[key]) throw new Error(`Mismatched run metadata: ${key}`);
  }
}
function validatedAttempt(work: Database.Database, run: RunRow, attempt: AcceptedAttemptRow): { draft: DraftRecord; entries: MergedEntry[] } {
  if (!attempt.raw_response || !attempt.response_sha256 || sha256(attempt.raw_response) !== attempt.response_sha256) throw new Error(`Raw response checksum mismatch for word ${attempt.game_word_id}`);
  const draft = validateDraft(JSON.parse(attempt.raw_response));
  if (draft.runId !== run.run_id || draft.wordId !== attempt.game_word_id || draft.word !== attempt.normalized_word || draft.provider !== run.provider || draft.model !== run.model || (draft.modelRevision ?? null) !== run.model_revision || draft.promptSha256 !== run.prompt_sha256) throw new Error(`Generation envelope mismatch for ${draft.word}`);
  if (attempt.attempt_status !== 'validated-draft' && attempt.attempt_status !== 'reviewed') throw new Error(`Attempt is not accepted for ${draft.word}`);
  if (attempt.task_status !== attempt.attempt_status) throw new Error(`Task/attempt status mismatch for ${draft.word}`);
  const validation = JSON.parse(attempt.validation_json ?? 'null') as Record<string, unknown> | null;
  if (!validation || validation.structurallyValid !== true || validation.styleVersion !== undefined && validation.styleVersion !== draft.styleVersion) throw new Error(`Accepted validation status is invalid for ${draft.word}`);
  if (attempt.attempt_status === 'reviewed' && validation.humanReviewed !== true) throw new Error(`Reviewed attempt lacks review evidence for ${draft.word}`);
  const stored = work.prepare('SELECT entry_ordinal,pos,definition,examples_json FROM generation_entries WHERE attempt_id=? ORDER BY entry_ordinal').all(attempt.id) as StoredEntryRow[];
  if (stored.length !== draft.entries.length) throw new Error(`Stored entries differ from raw response for ${draft.word}`);
  draft.entries.forEach((entry, index) => {
    const row = stored[index];
    if (!row || row.entry_ordinal !== entry.ordinal || row.pos !== entry.pos || row.definition !== entry.definition || row.examples_json !== JSON.stringify(entry.examples)) throw new Error(`Stored entries differ from raw response for ${draft.word}`);
  });
  return { draft, entries: draft.entries.map((entry) => ({ ...entry, gameWordId: draft.wordId, word: draft.word, validationJson: attempt.validation_json! })) };
}

/** Merge validated shards into a new artifact and publish it atomically without replacing an existing path. */
export function mergeShards(options: { sourceArtifact: string; outputArtifact: string; workPaths: string[] }): { mergedEntries:number; generatedWords:number } {
  const sourcePath = resolve(options.sourceArtifact); const outputPath = resolve(options.outputArtifact);
  if (sourcePath === outputPath) throw new Error('Merge output must be a new immutable artifact path.');
  if (existsSync(outputPath)) throw new Error(`Refusing to overwrite immutable artifact: ${outputPath}`);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  copyFileSync(sourcePath, temporary, constants.COPYFILE_EXCL);
  const artifact = new Database(temporary); artifact.pragma('foreign_keys = ON');
  const metadata = Object.fromEntries((artifact.prepare('SELECT key,value FROM artifact_metadata').all() as Array<{key:string;value:string}>).map(({key,value}) => [key,value]));
  let canonicalRun: RunRow | undefined; const entries: MergedEntry[] = []; const acceptedWords = new Set<number>();
  try {
    for (const rawWorkPath of options.workPaths) {
      const work = new Database(resolve(rawWorkPath), { readonly:true, fileMustExist:true });
      try {
        if (work.pragma('integrity_check', { simple:true }) !== 'ok') throw new Error('Work database integrity check failed.');
        const run = work.prepare('SELECT * FROM generation_runs').get() as RunRow | undefined;
        if (!run) throw new Error('Work database has no generation run.');
        if (run.source_artifact_version !== metadata.artifact_version || run.wordnet_source_sha256 !== metadata.wordnet_source_sha256) throw new Error('Work database is stale or belongs to another artifact.');
        if (run.prompt_sha256 !== AI_PROMPT_SHA256) throw new Error('Unsupported prompt version');
        if (!canonicalRun) canonicalRun = run; else assertSameRun(canonicalRun, run);
        const attempts = work.prepare(`SELECT a.id,a.game_word_id,t.normalized_word,t.status task_status,a.raw_response,a.response_sha256,a.status attempt_status,a.validation_json
          FROM generation_attempts a JOIN generation_tasks t ON t.run_id=a.run_id AND t.game_word_id=a.game_word_id
          WHERE a.status IN ('validated-draft','reviewed') ORDER BY a.game_word_id`).all() as AcceptedAttemptRow[];
        const acceptedTaskCount = (work.prepare("SELECT count(*) count FROM generation_tasks WHERE status IN ('validated-draft','reviewed')").get() as {count:number}).count;
        if (acceptedTaskCount !== attempts.length) throw new Error('Accepted tasks and attempts do not match.');
        for (const attempt of attempts) {
          if (acceptedWords.has(attempt.game_word_id)) throw new Error(`Duplicate accepted task for word ${attempt.game_word_id}`);
          const checked = validatedAttempt(work, run, attempt);
          acceptedWords.add(attempt.game_word_id); entries.push(...checked.entries);
        }
      } finally { work.close(); }
    }
    let generatedWords = 0;
    const transaction = artifact.transaction(() => {
      if (canonicalRun && entries.length) {
        const provenanceId = `ai:${canonicalRun.run_id}`;
        const outputHash = sha256(entries.map((entry) => JSON.stringify(entry)).join('\n'));
        artifact.prepare('INSERT INTO provenance VALUES (?,?,?,?,?,?,?,?,?,?)').run(provenanceId,'ai-generation',canonicalRun.provider,canonicalRun.model,canonicalRun.model_revision,canonicalRun.prompt_sha256,canonicalRun.parameters_json,canonicalRun.wordnet_source_sha256,outputHash,canonicalRun.created_at);
        const add = artifact.prepare('INSERT INTO generated_senses(game_word_id,sense_ordinal,pos,definition,examples_json,provenance_id,validation_json) VALUES (?,?,?,?,?,?,?)');
        for (const entry of entries) {
          const target = artifact.prepare('SELECT normalized FROM game_words WHERE id=?').get(entry.gameWordId) as {normalized:string}|undefined;
          if (!target || target.normalized !== entry.word) throw new Error(`Word identity mismatch for id ${entry.gameWordId}`);
          if (artifact.prepare('SELECT 1 FROM generated_senses WHERE game_word_id=? AND sense_ordinal=?').get(entry.gameWordId,entry.ordinal)) throw new Error(`Generated sense conflict for word ${entry.gameWordId} ordinal ${entry.ordinal}`);
          add.run(entry.gameWordId,entry.ordinal,entry.pos,entry.definition,JSON.stringify(entry.examples),provenanceId,entry.validationJson);
        }
      }
      generatedWords = (artifact.prepare('SELECT count(DISTINCT game_word_id) value FROM generated_senses').get() as {value:number}).value;
      const missing = (artifact.prepare('SELECT count(*) value FROM game_words g WHERE NOT EXISTS (SELECT 1 FROM wordnet_senses w WHERE w.game_word_id=g.id) AND NOT EXISTS (SELECT 1 FROM generated_senses a WHERE a.game_word_id=g.id)').get() as {value:number}).value;
      artifact.prepare("UPDATE artifact_metadata SET value=? WHERE key='generated_word_count'").run(String(generatedWords));
      artifact.prepare("UPDATE artifact_metadata SET value=? WHERE key='missing_definition_count'").run(String(missing));
      if (canonicalRun && entries.length) artifact.prepare('UPDATE provenance SET output_sha256=? WHERE id=?').run(canonicalGeneratedHash(artifact),`ai:${canonicalRun.run_id}`);
    });
    transaction(); artifact.close();
    validateRelease(temporary);
    try { linkSync(temporary, outputPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Refusing to overwrite immutable artifact: ${outputPath}`);
      throw error;
    }
    rmSync(temporary, { force:true });
    return { mergedEntries:entries.length, generatedWords };
  } catch (error) { try { artifact.close(); } catch {} rmSync(temporary,{force:true}); throw error; }
}

if (process.argv[1]?.endsWith('merge-shards.ts') || process.argv[1]?.endsWith('merge-shards.js')) {
  const result=mergeShards({sourceArtifact:requiredOption('artifact'),outputArtifact:requiredOption('output'),workPaths:requiredOption('work').split(',')});
  console.log(JSON.stringify(result));
}
