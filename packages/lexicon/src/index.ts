import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const APPLICATION_ID = 1464817476;
const SCHEMA_VERSION = 1;
export type WordNetPos = 'n' | 'v' | 'a' | 's' | 'r';
export type GeneratedPos = WordNetPos | 'other' | 'unknown';

export interface LexiconManifest {
  artifactVersion: string;
  schemaVersion: number;
  fileName: string;
  sha256: string;
  downloadUrl: string | null;
}
export interface DefinitionLookup {
  word: string;
  display: { pos: string; shortGloss: string; conciseGloss: string } | null;
  wordNetSenses: Array<{
    senseKey: string; synsetKey: string; lemma: string;
    matchKind: 'exact' | 'exception' | 'morphology'; senseNumber: number;
    pos: WordNetPos; definition: string; examples: string[];
  }>;
  generatedSenses: Array<{
    ordinal: number; pos: GeneratedPos; definition: string; examples: string[]; provenanceId: string;
  }>;
}
export interface DefinitionStore { lookup(word: string): DefinitionLookup | null; close(): void }

interface GameWordRow { id: number; spelling: string }
interface DisplayRow { display_pos: string; short_gloss: string; concise_gloss: string }
interface WordNetRow { sense_key: string; synset_key: string; resolved_lemma: string; match_kind: 'exact'|'exception'|'morphology'; sense_number: number; pos: WordNetPos; definition: string; examples_json: string }
interface GeneratedRow { sense_ordinal: number; pos: GeneratedPos; definition: string; examples_json: string; provenance_id: string }

function sha256File(path: string): string {
  const hash = createHash('sha256'); const fd = openSync(path, 'r'); const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { for (;;) { const length = readSync(fd, buffer, 0, buffer.length, null); if (!length) break; hash.update(buffer.subarray(0, length)); } return hash.digest('hex'); }
  finally { closeSync(fd); }
}
function sha256Lines(lines: Iterable<string>): string {
  const hash = createHash('sha256'); for (const line of lines) hash.update(line).update('\n'); return hash.digest('hex');
}
function jsonStrings(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error('Lexicon contains invalid examples JSON.');
  return parsed;
}
function metadataRecord(db: Database.Database): Record<string, string> {
  return Object.fromEntries((db.prepare('SELECT key,value FROM artifact_metadata').all() as Array<{key:string;value:string}>).map(({ key, value }) => [key, value]));
}
function verifyDatabase(db: Database.Database, expectedVersion?: string): Record<string, string> {
  db.pragma('query_only = ON'); db.pragma('foreign_keys = ON');
  if ((db.pragma('application_id', { simple: true }) as number) !== APPLICATION_ID) throw new Error('Invalid lexicon application id.');
  if ((db.pragma('user_version', { simple: true }) as number) !== SCHEMA_VERSION) throw new Error('Unsupported lexicon schema version.');
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Lexicon integrity check failed.');
  if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Lexicon foreign key check failed.');
  const metadata = metadataRecord(db);
  if (expectedVersion && metadata.artifact_version !== expectedVersion) throw new Error(`Expected lexicon ${expectedVersion}, found ${metadata.artifact_version ?? 'unknown'}.`);
  const rows = db.prepare('SELECT spelling,gameplay_eligible FROM game_words ORDER BY source_ordinal').iterate() as Iterable<{spelling:string;gameplay_eligible:number}>;
  let count = 0; let eligibleCount = 0; const eligibleWords: string[] = [];
  for (const row of rows) { count += 1; if (row.gameplay_eligible) { eligibleCount += 1; eligibleWords.push(row.spelling); } }
  if (count !== Number(metadata.source_word_count)) throw new Error('Lexicon source inventory count mismatch.');
  if (eligibleCount !== Number(metadata.eligible_word_count)) throw new Error('Lexicon eligible inventory count mismatch.');
  if (sha256Lines(eligibleWords) !== metadata.eligible_words_sha256) throw new Error('Lexicon eligible inventory checksum mismatch.');
  return metadata;
}
export function readManifest(path: string): LexiconManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid lexicon manifest.');
  const manifest = parsed as Partial<LexiconManifest>;
  if (typeof manifest.artifactVersion !== 'string' || manifest.schemaVersion !== SCHEMA_VERSION || typeof manifest.fileName !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')) throw new Error('Invalid lexicon manifest fields.');
  return manifest as LexiconManifest;
}
export function resolveLocalArtifact(manifestPath: string): { path: string; manifest: LexiconManifest } {
  const absoluteManifest = resolve(manifestPath); const manifest = readManifest(absoluteManifest);
  return { path: resolve(dirname(absoluteManifest), manifest.fileName), manifest };
}

export function openDefinitionStore(options: { path: string; expectedArtifactVersion?: string; expectedSha256?: string }): DefinitionStore {
  if (options.expectedSha256 && sha256File(options.path) !== options.expectedSha256.toLowerCase()) throw new Error('Lexicon SHA-256 mismatch.');
  const db = new Database(options.path, { readonly: true, fileMustExist: true });
  try {
    verifyDatabase(db, options.expectedArtifactVersion);
    const findWord = db.prepare('SELECT id, spelling FROM game_words WHERE normalized = ?');
    const findDisplay = db.prepare('SELECT display_pos, short_gloss, concise_gloss FROM display_glosses WHERE game_word_id = ?');
    const findWordNet = db.prepare(`SELECT s.sense_key,s.synset_key,s.resolved_lemma,s.match_kind,s.sense_number,y.pos,y.definition,y.examples_json
      FROM wordnet_senses s JOIN wordnet_synsets y ON y.synset_key=s.synset_key WHERE s.game_word_id=? ORDER BY y.pos,s.resolved_lemma,s.sense_number,s.sense_key`);
    const findGenerated = db.prepare('SELECT sense_ordinal,pos,definition,examples_json,provenance_id FROM generated_senses WHERE game_word_id=? ORDER BY sense_ordinal');
    return {
      lookup(input) {
        const normalized = input.trim().toLowerCase(); if (!/^[a-z]+$/.test(normalized)) return null;
        const word = findWord.get(normalized) as GameWordRow | undefined; if (!word) return null;
        const display = findDisplay.get(word.id) as DisplayRow | undefined;
        const wordNetSenses = (findWordNet.all(word.id) as WordNetRow[]).map((row) => ({ senseKey: row.sense_key, synsetKey: row.synset_key, lemma: row.resolved_lemma, matchKind: row.match_kind, senseNumber: row.sense_number, pos: row.pos, definition: row.definition, examples: jsonStrings(row.examples_json) }));
        const generatedSenses = (findGenerated.all(word.id) as GeneratedRow[]).map((row) => ({ ordinal: row.sense_ordinal, pos: row.pos, definition: row.definition, examples: jsonStrings(row.examples_json), provenanceId: row.provenance_id }));
        return { word: word.spelling, display: display ? { pos: display.display_pos, shortGloss: display.short_gloss, conciseGloss: display.concise_gloss } : null, wordNetSenses, generatedSenses };
      }, close() { db.close(); }
    };
  } catch (error) { db.close(); throw error; }
}

/** Trusted runtime seam: verify the tracked manifest and database once at startup, then retain only the in-memory inventory. */
export function loadPlayableWords(options: { path: string; expectedArtifactVersion?: string; expectedSha256?: string }): string[] {
  if (!options.path) throw new Error('A lexicon artifact path is required.');
  if (!options.expectedArtifactVersion || !options.expectedSha256) throw new Error('Lexicon artifact version and SHA-256 are required.');
  if (sha256File(options.path) !== options.expectedSha256.toLowerCase()) throw new Error('Lexicon SHA-256 mismatch.');
  const db = new Database(options.path, { readonly: true, fileMustExist: true });
  try {
    verifyDatabase(db, options.expectedArtifactVersion);
    return (db.prepare('SELECT spelling FROM game_words ORDER BY source_ordinal').all() as Array<{ spelling: string }>).map(({ spelling }) => spelling);
  } finally { db.close(); }
}
export function loadPlayableWordsFromManifest(options: { manifestPath: string; artifactPath?: string }): string[] {
  const { path: defaultPath, manifest } = resolveLocalArtifact(options.manifestPath);
  return loadPlayableWords({ path: options.artifactPath ? resolve(options.artifactPath) : defaultPath, expectedArtifactVersion: manifest.artifactVersion, expectedSha256: manifest.sha256 });
}
