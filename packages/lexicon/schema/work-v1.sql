PRAGMA application_id = 1464817476;
PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;
CREATE TABLE generation_runs (
 run_id TEXT PRIMARY KEY, source_artifact_version TEXT NOT NULL, wordnet_source_sha256 TEXT NOT NULL,
 provider TEXT NOT NULL, model TEXT NOT NULL, model_revision TEXT, prompt_sha256 TEXT NOT NULL,
 parameters_json TEXT NOT NULL CHECK(json_valid(parameters_json)), shard_count INTEGER NOT NULL CHECK(shard_count > 0), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE generation_tasks (
 run_id TEXT NOT NULL REFERENCES generation_runs(run_id), game_word_id INTEGER NOT NULL, normalized_word TEXT NOT NULL,
 shard_index INTEGER NOT NULL CHECK(shard_index >= 0), status TEXT NOT NULL CHECK(status IN ('pending','processing','validated-draft','reviewed','retryable','rejected')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0), lease_token TEXT, lease_expires_at TEXT, last_error TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(run_id,game_word_id)
) STRICT;
CREATE TABLE generation_attempts (
 id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, game_word_id INTEGER NOT NULL, attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
 request_started_at TEXT NOT NULL, request_finished_at TEXT, provider_response_id TEXT, raw_response TEXT, response_sha256 TEXT,
 status TEXT NOT NULL CHECK(status IN ('requested','transport-error','parse-error','rejected','validated-draft','reviewed')),
 validation_json TEXT CHECK(validation_json IS NULL OR json_valid(validation_json)),
 FOREIGN KEY(run_id,game_word_id) REFERENCES generation_tasks(run_id,game_word_id), UNIQUE(run_id,game_word_id,attempt_number)
) STRICT;
CREATE UNIQUE INDEX one_accepted_attempt_per_word ON generation_attempts(run_id,game_word_id) WHERE status IN ('validated-draft','reviewed');
CREATE TABLE generation_entries (
 attempt_id INTEGER NOT NULL REFERENCES generation_attempts(id), entry_ordinal INTEGER NOT NULL CHECK(entry_ordinal > 0),
 pos TEXT NOT NULL CHECK(pos IN ('n','v','a','s','r','other','unknown')), definition TEXT NOT NULL,
 examples_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(examples_json)), PRIMARY KEY(attempt_id,entry_ordinal)
) STRICT;
