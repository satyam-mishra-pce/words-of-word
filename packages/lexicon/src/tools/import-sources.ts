import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { ARTIFACT_VERSION, hashNamedFiles, option, parseWordNetGloss, sha256, sha256File } from './common.js';

const require = createRequire(import.meta.url);
const output = resolve(option('output') ?? 'artifacts/words-of-word-lexicon-v0.1.0.sqlite');
const schemaPath = new URL('../../schema/release-v1.sql', import.meta.url);
const rawWords: unknown = require('an-array-of-english-words');
if (!Array.isArray(rawWords) || !rawWords.every((word) => typeof word === 'string')) throw new Error('Invalid pinned word inventory.');
const words = rawWords as string[];
const wordnet = require('wordnet-db') as { path: string };
const dictPath = wordnet.path;
const createdAt = '1970-01-01T00:00:00.000Z';

interface Synset { key: string; offset: number; pos: string; lex: number; raw: string; definition: string; examples: string[] }
interface IndexedSense { senseKey: string; synsetKey: string; senseNumber: number; tagCount: number }

function readSynsets(): Map<string, Synset> {
  const result = new Map<string, Synset>();
  for (const filePos of ['noun', 'verb', 'adj', 'adv']) {
    for (const line of readFileSync(resolve(dictPath, `data.${filePos}`), 'utf8').split('\n')) {
      if (!/^\d{8}\s/.test(line)) continue;
      const divider = line.indexOf(' | '); if (divider < 0) continue;
      const head = line.slice(0, divider).split(/\s+/); const offset = Number(head[0]); const lex = Number(head[1]); const pos = head[2]!;
      const raw = line.slice(divider + 3).trim(); const gloss = parseWordNetGloss(raw); const key = `${pos}:${String(offset).padStart(8, '0')}`;
      result.set(key, { key, offset, pos, lex, raw, ...gloss });
    }
  }
  return result;
}
function readSenses(synsets: Map<string, Synset>): Map<string, IndexedSense[]> {
  const result = new Map<string, IndexedSense[]>();
  for (const line of readFileSync(resolve(dictPath, 'index.sense'), 'utf8').split('\n')) {
    if (!line) continue;
    const [senseKey, offsetRaw, senseNumberRaw, tagRaw] = line.split(' '); if (!senseKey || !offsetRaw) continue;
    const lemma = senseKey.slice(0, senseKey.indexOf('%')).toLowerCase();
    const posDigit = senseKey.split('%')[1]?.[0];
    const requestedPos = ({ '1': 'n', '2': 'v', '3': 'a', '4': 'r', '5': 's' } as Record<string, string>)[posDigit ?? ''];
    if (!requestedPos) continue;
    // WordNet sense-key type 3 is an adjective (`a`) and type 5 is an
    // adjective satellite (`s`). Offsets are POS-scoped, so never fall back
    // across those identities even though both display as adjectives.
    const synset = synsets.get(`${requestedPos}:${offsetRaw}`);
    if (!synset) throw new Error(`Missing exact POS synset for ${senseKey}`);
    const entries = result.get(lemma) ?? [];
    entries.push({ senseKey, synsetKey: synset.key, senseNumber: Number(senseNumberRaw), tagCount: Number(tagRaw) }); result.set(lemma, entries);
  }
  return result;
}
function exceptions(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const filePos of ['noun', 'verb', 'adj', 'adv']) {
    const path = resolve(dictPath, `${filePos}.exc`);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const [inflected, ...lemmas] = line.trim().split(/\s+/); if (!inflected) continue;
      const set = result.get(inflected) ?? new Set<string>(); for (const lemma of lemmas) set.add(lemma); result.set(inflected, set);
    }
  }
  return result;
}
const substitutions: Array<[string, string]> = [
  ['sses', 'ss'], ['ies', 'y'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['s', ''],
  ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''], ['er', ''], ['est', '']
];
function resolvedLemmas(word: string, known: Map<string, IndexedSense[]>, exceptionMap: Map<string, Set<string>>): Map<string, 'exact'|'exception'|'morphology'> {
  const result = new Map<string, 'exact'|'exception'|'morphology'>();
  if (known.has(word)) { result.set(word, 'exact'); return result; }
  for (const lemma of exceptionMap.get(word) ?? []) if (known.has(lemma)) result.set(lemma, 'exception');
  if (result.size > 0) return result;
  for (const [suffix, replacement] of substitutions) if (word.endsWith(suffix)) { const lemma = word.slice(0, -suffix.length) + replacement; if (known.has(lemma) && !result.has(lemma)) result.set(lemma, 'morphology'); }
  return result;
}
function canonicalQueryHash(db: Database.Database, sql: string): string {
  const hash = createHash('sha256');
  for (const row of db.prepare(sql).iterate() as Iterable<Record<string, unknown>>) hash.update(JSON.stringify(row)).update('\n');
  return hash.digest('hex');
}

mkdirSync(dirname(output), { recursive: true }); rmSync(output, { force: true });
const db = new Database(output); db.exec(readFileSync(schemaPath, 'utf8'));
const synsets = readSynsets(); const senses = readSenses(synsets); const exceptionMap = exceptions();
const packageEntry = require.resolve('an-array-of-english-words');
const eligible = words.filter((word) => word.length > 1);
const wordInputHash = sha256File(packageEntry); const eligibleHash = sha256(`${eligible.join('\n')}\n`);
const wordNetFiles = [
  ...['noun', 'verb', 'adj', 'adv'].flatMap((name) => [`data.${name}`, `${name}.exc`]),
  'index.sense'
].filter((name) => existsSync(resolve(dictPath, name))).map((name) => ({ name, path: resolve(dictPath, name) }));
const wnInputHash = hashNamedFiles(wordNetFiles);
const insertProvenance = db.prepare('INSERT INTO provenance VALUES (?,?,?,?,?,?,?,?,?,?)');
const insertMetadata = db.prepare('INSERT INTO artifact_metadata VALUES (?,?)');
const insertWord = db.prepare('INSERT INTO game_words(id,source_ordinal,spelling,normalized,gameplay_eligible,provenance_id) VALUES (?,?,?,?,?,?)');
const insertSynset = db.prepare('INSERT INTO wordnet_synsets VALUES (?,?,?,?,?,?,?,?)');
const insertSense = db.prepare('INSERT OR IGNORE INTO wordnet_senses VALUES (?,?,?,?,?,?,?)');
const insertDisplay = db.prepare('INSERT INTO display_glosses VALUES (?,?,?,?,?,?)');
let backed = 0;
db.transaction(() => {
  // Output hashes are replaced with canonical imported-row hashes after all rows exist.
  insertProvenance.run('word-list-v2', 'word-list-import', 'an-array-of-english-words', '2.0.0', null, null, '{}', wordInputHash, '', createdAt);
  insertProvenance.run('wordnet-3.1', 'wordnet-import', 'wordnet-db corpus', '3.1.14', null, null, JSON.stringify({ corpusLabel: 'WordNet 3.1 data package; bundled notice names WordNet 3.0' }), wnInputHash, '', createdAt);
  insertProvenance.run('display-v1', 'deterministic-transform', '@wow/lexicon', '0.1.0', null, null, JSON.stringify({ selection: 'first ordered sense', shortLimit: 120, conciseLimit: 240 }), wnInputHash, '', createdAt);
  for (const synset of synsets.values()) insertSynset.run(synset.key, synset.offset, synset.pos, synset.lex, synset.raw, synset.definition, JSON.stringify(synset.examples), 'wordnet-3.1');
  words.forEach((word, index) => insertWord.run(index + 1, index, word, word.trim().toLowerCase(), word.length > 1 ? 1 : 0, 'word-list-v2'));
  words.forEach((word, index) => {
    let found = false;
    for (const [lemma, kind] of resolvedLemmas(word.toLowerCase(), senses, exceptionMap)) for (const sense of senses.get(lemma) ?? []) {
      const synset = synsets.get(sense.synsetKey);
      if (!synset) throw new Error(`Missing preserved synset ${sense.synsetKey}`);
      insertSense.run(index + 1, sense.senseKey, synset.key, lemma, kind, sense.senseNumber, sense.tagCount); found = true;
    }
    if (found) backed++;
  });
  const displayRows = db.prepare(`SELECT g.id,s.sense_key,y.pos,y.definition,
    (SELECT count(DISTINCT CASE y2.pos WHEN 'n' THEN 'noun' WHEN 'v' THEN 'verb' WHEN 'a' THEN 'adjective' WHEN 's' THEN 'adjective' WHEN 'r' THEN 'adverb' END)
     FROM wordnet_senses s2 JOIN wordnet_synsets y2 ON y2.synset_key=s2.synset_key WHERE s2.game_word_id=g.id) pos_count
    FROM game_words g JOIN wordnet_senses s ON s.game_word_id=g.id JOIN wordnet_synsets y ON y.synset_key=s.synset_key
    WHERE s.sense_key=(SELECT s3.sense_key FROM wordnet_senses s3 JOIN wordnet_synsets y3 ON y3.synset_key=s3.synset_key WHERE s3.game_word_id=g.id ORDER BY y3.pos,s3.resolved_lemma,s3.sense_number,s3.sense_key LIMIT 1)
    ORDER BY g.id`).all() as Array<{id:number;sense_key:string;pos:string;definition:string;pos_count:number}>;
  const bounded = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
  const displayPos = (pos: string, count: number): string => count > 1 ? 'multiple' : pos === 'n' ? 'noun' : pos === 'v' ? 'verb' : pos === 'r' ? 'adverb' : 'adjective';
  for (const row of displayRows) insertDisplay.run(row.id, displayPos(row.pos, row.pos_count), bounded(row.definition, 120), bounded(row.definition, 240), JSON.stringify([`wordnet:${row.sense_key}`]), 'display-v1');
  db.prepare('UPDATE provenance SET output_sha256=? WHERE id=?').run(canonicalQueryHash(db, 'SELECT source_ordinal,spelling,normalized,gameplay_eligible FROM game_words ORDER BY source_ordinal'), 'word-list-v2');
  db.prepare('UPDATE provenance SET output_sha256=? WHERE id=?').run(canonicalQueryHash(db, `SELECT s.sense_key,s.synset_key,s.game_word_id,s.resolved_lemma,s.match_kind,s.sense_number,s.tag_count,y.pos,y.raw_gloss,y.definition,y.examples_json FROM wordnet_senses s JOIN wordnet_synsets y ON y.synset_key=s.synset_key ORDER BY s.game_word_id,s.sense_key`), 'wordnet-3.1');
  db.prepare('UPDATE provenance SET output_sha256=? WHERE id=?').run(canonicalQueryHash(db, 'SELECT game_word_id,display_pos,short_gloss,concise_gloss,source_refs_json FROM display_glosses ORDER BY game_word_id'), 'display-v1');
  const values: Record<string, string> = {
    schema_version: '1', artifact_version: ARTIFACT_VERSION, release_status: 'partial', source_word_package: 'an-array-of-english-words', source_word_version: '2.0.0',
    source_word_count: String(words.length), source_word_entry_sha256: wordInputHash, eligible_word_count: String(eligible.length), eligible_words_sha256: eligibleHash,
    wordnet_corpus_version: 'wordnet-db@3.1.14', wordnet_source_sha256: wnInputHash, wordnet_backed_word_count: String(backed), generated_word_count: '0', display_gloss_count: String(displayRows.length),
    missing_definition_count: String(words.length - backed), build_recipe_version: '@wow/lexicon-0.1.0'
  };
  for (const [key, value] of Object.entries(values)) insertMetadata.run(key, value);
  db.prepare('INSERT INTO licenses VALUES (?,?,?,?,?)').run('wordnet-db corpus', '3.1.14', 'Bundled WordNet notice (notice text identifies WordNet Release 3.0)', readFileSync(resolve(dictPath, '../LICENSE'), 'utf8'), 'https://www.npmjs.com/package/wordnet-db');
  db.prepare('INSERT INTO licenses VALUES (?,?,?,?,?)').run('an-array-of-english-words', '2.0.0', 'MIT', readFileSync(resolve(dirname(packageEntry), 'license'), 'utf8'), 'https://github.com/words/an-array-of-english-words');
})();
db.exec('ANALYZE'); db.close();
console.log(JSON.stringify({ output, words: words.length, eligible: eligible.length, wordnetBacked: backed, missing: words.length - backed, sha256: sha256File(output) }, null, 2));
