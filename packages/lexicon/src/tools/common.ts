import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';

export const APPLICATION_ID = 1464817476;
export const SCHEMA_VERSION = 1;
export const ARTIFACT_VERSION = '0.1.0';
export const DEFAULT_ARTIFACT_FILE = `words-of-word-lexicon-v${ARTIFACT_VERSION}.sqlite`;
export const POS = ['n', 'v', 'a', 's', 'r'] as const;
export type Pos = typeof POS[number];
export const AI_STYLE_VERSION = 'wow-educational-definition-v1';
export const AI_PROMPT = `Style ${AI_STYLE_VERSION}: Define the supplied word in plain, neutral educational English. Return JSON only. Preserve distinct senses, identify part of speech, avoid circular definitions, unsupported claims, branding, and usage advice. Definitions must be 1-240 characters and examples 0-180 characters.`;
export const AI_PROMPT_SHA256 = sha256(AI_PROMPT);

export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
/** Hash large artifacts without loading them completely into the Node heap. */
export function sha256File(path: string): string {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const length = readSync(fd, buffer, 0, buffer.length, null);
      if (length === 0) break;
      hash.update(buffer.subarray(0, length));
    }
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
export function hashNamedFiles(files: Array<{ name: string; path: string }>): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(`${file.name}\0`);
    hash.update(readFileSync(file.path));
    hash.update('\0');
  }
  return hash.digest('hex');
}
export function shardFor(word: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error('shard count must be a positive integer');
  const prefix = createHash('sha256').update(word).digest().subarray(0, 8);
  return Number(prefix.readBigUInt64BE() % BigInt(count));
}
export function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
export function requiredOption(name: string): string {
  const value = option(name); if (!value) throw new Error(`Missing --${name}=...`); return value;
}
export function stableJson(value: unknown): string { return `${JSON.stringify(value)}\n`; }
/** Parse WordNet's `definition; "example"` grammar without splitting semicolons inside quoted examples. */
export function parseWordNetGloss(raw: string): { definition: string; examples: string[] } {
  const pieces: string[] = []; let piece = ''; let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') { piece += '""'; index += 1; continue; }
      quoted = !quoted; piece += char;
    } else if (char === ';' && !quoted) { pieces.push(piece.trim()); piece = ''; }
    else piece += char;
  }
  if (quoted) throw new Error(`Unterminated quoted WordNet gloss: ${raw}`);
  if (piece.trim()) pieces.push(piece.trim());
  const examples: string[] = []; const definitions: string[] = [];
  for (const value of pieces) {
    if (value.startsWith('"') && value.endsWith('"')) examples.push(value.slice(1, -1).replace(/""/g, '"'));
    else if (value) definitions.push(value);
  }
  return { definition: definitions.join('; '), examples };
}
