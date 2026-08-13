PRAGMA application_id = 1464817476;
PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;

CREATE TABLE artifact_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE licenses (component TEXT PRIMARY KEY, version TEXT NOT NULL, license_name TEXT NOT NULL, license_text TEXT NOT NULL, source_url TEXT NOT NULL) STRICT;
CREATE TABLE provenance (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('word-list-import','wordnet-import','ai-generation','deterministic-transform')),
  producer TEXT NOT NULL, producer_version TEXT NOT NULL, model_revision TEXT, prompt_sha256 TEXT,
  parameters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(parameters_json)),
  input_sha256 TEXT NOT NULL, output_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK (kind <> 'ai-generation' OR prompt_sha256 IS NOT NULL)
) STRICT;
CREATE TABLE game_words (
  id INTEGER PRIMARY KEY, source_ordinal INTEGER NOT NULL UNIQUE CHECK (source_ordinal >= 0),
  spelling TEXT NOT NULL UNIQUE, normalized TEXT NOT NULL UNIQUE,
  gameplay_eligible INTEGER NOT NULL CHECK (gameplay_eligible IN (0,1)),
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  CHECK (normalized = lower(trim(spelling)))
) STRICT;
CREATE TABLE wordnet_synsets (
  synset_key TEXT PRIMARY KEY, synset_offset INTEGER NOT NULL CHECK (synset_offset >= 0),
  pos TEXT NOT NULL CHECK (pos IN ('n','v','a','s','r')), lexicographer_id INTEGER NOT NULL CHECK (lexicographer_id >= 0),
  raw_gloss TEXT NOT NULL, definition TEXT NOT NULL, examples_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(examples_json)),
  provenance_id TEXT NOT NULL REFERENCES provenance(id), UNIQUE (synset_offset,pos)
) STRICT;
CREATE TABLE wordnet_senses (
  game_word_id INTEGER NOT NULL REFERENCES game_words(id), sense_key TEXT NOT NULL,
  synset_key TEXT NOT NULL REFERENCES wordnet_synsets(synset_key), resolved_lemma TEXT NOT NULL,
  match_kind TEXT NOT NULL CHECK (match_kind IN ('exact','exception','morphology')),
  sense_number INTEGER NOT NULL CHECK (sense_number > 0), tag_count INTEGER NOT NULL DEFAULT 0 CHECK (tag_count >= 0),
  PRIMARY KEY (game_word_id,sense_key), UNIQUE (game_word_id,resolved_lemma,sense_number,synset_key)
) STRICT;
CREATE INDEX wordnet_senses_word_order ON wordnet_senses(game_word_id,resolved_lemma,sense_number);
CREATE TABLE generated_senses (
  id INTEGER PRIMARY KEY, game_word_id INTEGER NOT NULL REFERENCES game_words(id),
  sense_ordinal INTEGER NOT NULL CHECK (sense_ordinal > 0), pos TEXT NOT NULL CHECK (pos IN ('n','v','a','s','r','other','unknown')),
  definition TEXT NOT NULL, examples_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(examples_json)),
  provenance_id TEXT NOT NULL REFERENCES provenance(id), validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  UNIQUE (game_word_id,sense_ordinal)
) STRICT;
CREATE INDEX generated_senses_word_order ON generated_senses(game_word_id,sense_ordinal);
CREATE TABLE display_glosses (
  game_word_id INTEGER PRIMARY KEY REFERENCES game_words(id),
  display_pos TEXT NOT NULL CHECK (display_pos IN ('noun','verb','adjective','adverb','multiple','other','unknown')),
  short_gloss TEXT NOT NULL CHECK (length(short_gloss) BETWEEN 1 AND 120),
  concise_gloss TEXT NOT NULL CHECK (length(concise_gloss) BETWEEN 1 AND 240),
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)), provenance_id TEXT NOT NULL REFERENCES provenance(id)
) STRICT;
CREATE INDEX game_words_normalized_lookup ON game_words(normalized);
