import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { APPLICATION_ID, requiredOption, sha256, sha256File } from './common.js';
const require = createRequire(import.meta.url);

function expectedSensePos(senseKey: string): string {
  const digit = senseKey.split('%')[1]?.[0];
  const pos = ({ '1':'n', '2':'v', '3':'a', '4':'r', '5':'s' } as Record<string,string>)[digit ?? ''];
  if (!pos) throw new Error(`Unknown sense-key POS: ${senseKey}`);
  return pos;
}
export function validateRelease(path: string, expected?: { version?: string; sha256?: string }): Record<string, string | number> {
  if (expected?.sha256 && sha256File(path) !== expected.sha256.toLowerCase()) throw new Error('artifact SHA-256 mismatch');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const fail = (message: string): never => { throw new Error(message); };
  try {
    db.pragma('foreign_keys = ON');
    if ((db.pragma('application_id', { simple: true }) as number) !== APPLICATION_ID) fail('application_id mismatch');
    if ((db.pragma('user_version', { simple: true }) as number) !== 1) fail('user_version mismatch');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('integrity_check failed');
    if ((db.pragma('foreign_key_check') as unknown[]).length) fail('foreign_key_check failed');
    const metadata = Object.fromEntries((db.prepare('SELECT key,value FROM artifact_metadata').all() as Array<{key:string;value:string}>).map(({key,value}) => [key,value]));
    if (expected?.version && metadata.artifact_version !== expected.version) fail('artifact version mismatch');
    const words = db.prepare('SELECT spelling,gameplay_eligible FROM game_words ORDER BY source_ordinal').all() as Array<{spelling:string;gameplay_eligible:number}>;
    const legacy: string[] = require('an-array-of-english-words');
    if (words.length !== legacy.length || words.some((row,index) => row.spelling !== legacy[index])) fail('ordered inventory parity failed');
    const eligible = words.filter(({gameplay_eligible}) => gameplay_eligible).map(({spelling}) => spelling);
    if (Number(metadata.source_word_count) !== words.length || Number(metadata.eligible_word_count) !== eligible.length) fail('inventory metadata mismatch');
    if (metadata.eligible_words_sha256 !== sha256(`${eligible.join('\n')}\n`)) fail('eligible inventory checksum failed');
    const senseRows = db.prepare('SELECT s.sense_key,y.pos FROM wordnet_senses s JOIN wordnet_synsets y ON y.synset_key=s.synset_key').all() as Array<{sense_key:string;pos:string}>;
    const mismatches = senseRows.filter(({sense_key,pos}) => expectedSensePos(sense_key) !== pos);
    if (mismatches.length) fail(`sense/POS mismatches: ${mismatches.length}`);
    for (const key of ['wordnet_backed_word_count','generated_word_count','display_gloss_count']) {
      const table = key.startsWith('wordnet') ? 'wordnet_senses' : key.startsWith('generated') ? 'generated_senses' : 'display_glosses';
      const value = (db.prepare(`SELECT count(DISTINCT game_word_id) value FROM ${table}`).get() as {value:number}).value;
      if (Number(metadata[key]) !== value) fail(`${key} coverage mismatch`);
    }
    const missing = (db.prepare('SELECT count(*) value FROM game_words g WHERE NOT EXISTS (SELECT 1 FROM wordnet_senses w WHERE w.game_word_id=g.id) AND NOT EXISTS (SELECT 1 FROM generated_senses a WHERE a.game_word_id=g.id)').get() as {value:number}).value;
    if (Number(metadata.missing_definition_count) !== missing) fail('missing coverage mismatch');
    return { artifactVersion:metadata.artifact_version!, releaseStatus:metadata.release_status!, words:words.length, eligible:eligible.length, wordnetBacked:Number(metadata.wordnet_backed_word_count), generated:Number(metadata.generated_word_count), missing, sensePosMismatches:mismatches.length, sha256:sha256File(path) };
  } finally { db.close(); }
}
if (process.argv[1]?.endsWith('validate-release.ts') || process.argv[1]?.endsWith('validate-release.js')) console.log(JSON.stringify(validateRelease(resolve(requiredOption('artifact'))), null, 2));
