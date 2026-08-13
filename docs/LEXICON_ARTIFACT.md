# Owned lexicon artifact

Phase 1 owns a versioned educational lexicon without changing the game UI or exposing a definition API. The server authenticates the SQLite artifact once at startup, loads the exact ordered inventory, closes SQLite, and retains the existing in-memory `ValidWordIndex`/`Set` hot path. SQLite is never queried per submission.

## Sources, provenance, and coverage

- **an-array-of-english-words 2.0.0** supplies the exact historical ordered inventory. Its package is MIT-licensed; its README says the list derives from Letterpress. Retaining this input preserves gameplay, but its upstream origin should receive separate redistribution due diligence before describing the resulting inventory as independently owned.
- **wordnet-db 3.1.14** supplies WordNet-format data. The package labels its corpus 3.1, while its bundled license notice text identifies WordNet Release 3.0. The artifact records both facts without making a legal conclusion. Review the embedded notice and upstream terms before publication.

The importer preserves every WordNet sense, exact POS-specific synset identity (including adjective satellites), raw gloss, quote-aware separated definition/examples, resolved lemma, and match method. Provenance input hashes cover all consumed `data.*`, `index.sense`, and exception files; output hashes cover canonical imported rows.

Current deterministic partial coverage is recorded in the manifest/artifact metadata. Missing entries remain valid gameplay words and are not falsely claimed as defined or AI-generated.

## Deterministic local build and validation

No install lifecycle downloads data and no SQLite database is committed. After `pnpm install --frozen-lockfile`:

```sh
pnpm lexicon:build
pnpm lexicon:validate
pnpm test:lexicon
```

`lexicon:build` never rewrites the tracked manifest. `lexicon:pin-release` is an explicit release-authoring operation that updates the trust-root checksum; it must be reviewed separately. Rebuilding identical pinned sources and recipe produces identical bytes.

The tracked manifest contains the checksum of the reviewed local build but no download URL because nothing has been published. `pnpm lexicon:fetch` only downloads a published immutable artifact and fails clearly otherwise. For this unpublished phase, run `pnpm lexicon:build` explicitly.

Runtime variables are optional in the repository layout:

- `LEXICON_MANIFEST_PATH` overrides the tracked manifest path.
- `LEXICON_DB_PATH` overrides the artifact file path while retaining manifest version/checksum verification.

Startup verifies SHA-256, application/schema IDs, artifact metadata version, SQLite integrity/foreign keys, inventory counts, and the eligible-inventory checksum before accepting words.

## AI draft workflow

Style/prompt version is `wow-educational-definition-v1`. This repository creates deterministic tasks and imports external structured responses; it makes no model calls and claims no generated coverage.

```sh
pnpm --filter @wow/lexicon ai:generate init --artifact=artifacts/words-of-word-lexicon-v0.1.0.sqlite --work=work/shard-0.sqlite --shards=64 --provider=... --model=...
pnpm --filter @wow/lexicon ai:generate export --work=work/shard-0.sqlite --shard=0 --output=work/tasks-0.jsonl
# An separately authorized generator produces work/drafts-0.jsonl.
pnpm --filter @wow/lexicon ai:generate import --work=work/shard-0.sqlite --input=work/drafts-0.jsonl
pnpm --filter @wow/lexicon ai:merge --artifact=artifacts/words-of-word-lexicon-v0.1.0.sqlite --output=artifacts/words-of-word-lexicon-v0.1.0-ai-run.sqlite --work=work/shard-0.sqlite
```

Imported model responses are structurally validated **AI drafts**, not source-verified definitions. Limits apply to file/line sizes, senses, examples, text, controls, and markup. Provider/model/revision/run/prompt envelopes must match. Merge binds every shard to the target artifact, rejects conflicts, validates a temporary copy, and atomically creates a new immutable filename.

Work databases, tasks, drafts, SQLite sidecars, and generated artifacts are excluded from Git and Docker context.

## Deployment note

Until an immutable release is published, Docker/Render builders construct the artifact from pinned local packages. The importer has been observed near the 512 MiB free-builder envelope, so this is a residual deployment risk—not a passed constrained-capacity claim. Publish the checksum-pinned artifact and change deployment to `lexicon:fetch` before relying on a 512 MiB build environment. Runtime keeps only the final artifact plus production dependencies and still uses the in-memory gameplay index.
