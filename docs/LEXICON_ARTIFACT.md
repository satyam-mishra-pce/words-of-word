# Owned lexicon artifact

The project owns a versioned educational lexicon and offline definition API. The server authenticates the SQLite artifact once at startup, loads the exact ordered inventory into the existing in-memory `ValidWordIndex`/`Set` hot path, and retains one read-only definition store. SQLite is never queried for submission validation.

## Sources, provenance, and coverage

- **an-array-of-english-words 2.0.0** supplies the exact historical ordered inventory. Its package is MIT-licensed; its README says the list derives from Letterpress. Retaining this input preserves gameplay, but its upstream origin should receive separate redistribution due diligence before describing the resulting inventory as independently owned.
- **wordnet-db 3.1.14** supplies WordNet-format data. The package labels its corpus 3.1, while its bundled license notice text identifies WordNet Release 3.0. The artifact records both facts without making a legal conclusion. Review the embedded notice and upstream terms before publication.

The importer preserves every WordNet sense, exact POS-specific synset identity (including adjective satellites), raw gloss, quote-aware separated definition/examples, resolved lemma, and match method. Provenance input hashes cover all consumed `data.*`, `index.sense`, and exception files; output hashes cover canonical imported rows.

Artifact `0.2.0` has deterministic full coverage: all 274,932 playable words have at least one WordNet or generated sense. It contains 120,121 WordNet-backed words and 154,816 generated words from pinned generation run `7497b731-5494-4796-8999-12ac1c641d76`.

## Deterministic local build and validation

No install lifecycle downloads data and no SQLite database is committed. After `pnpm install --frozen-lockfile`:

```sh
pnpm lexicon:ensure
pnpm lexicon:validate
pnpm test:lexicon
```

`lexicon:build` constructs only the deterministic WordNet base artifact used as generation input; it does not recreate the generated release or rewrite the tracked manifest. `lexicon:pin-release` is an explicit release-authoring operation that updates the trust-root checksum and must be reviewed separately.

The tracked manifest pins the reviewed full-coverage artifact to an immutable, access-controlled GitHub release URL and SHA-256 checksum. The repository also tracks a compressed copy so private remote builders do not require separate GitHub release credentials. `pnpm lexicon:ensure` uses an existing artifact when present and otherwise delegates to `lexicon:fetch`, which expands the bundled copy (or downloads the release fallback) and verifies the final checksum.

Runtime variables are optional in the repository layout:

- `LEXICON_MANIFEST_PATH` overrides the tracked manifest path.
- `LEXICON_DB_PATH` overrides the artifact file path while retaining manifest version/checksum verification.

Startup verifies SHA-256, application/schema IDs, artifact metadata version, SQLite integrity/foreign keys, inventory counts, and the eligible-inventory checksum before accepting words.

## AI draft workflow

Style/prompt version is `wow-educational-definition-v1`. The repository creates deterministic tasks and imports structured model responses. Generated definitions are stored with their raw response hashes, pinned model/revision/run/prompt metadata, and validation records.

```sh
pnpm --filter @wow/lexicon ai:generate init --artifact=artifacts/words-of-word-lexicon-v0.1.0.sqlite --work=work/shard-0.sqlite --shards=64 --provider=... --model=...
pnpm --filter @wow/lexicon ai:generate export --work=work/shard-0.sqlite --shard=0 --output=work/tasks-0.jsonl
# An separately authorized generator produces work/drafts-0.jsonl.
pnpm --filter @wow/lexicon ai:generate import --work=work/shard-0.sqlite --input=work/drafts-0.jsonl
pnpm --filter @wow/lexicon ai:merge --artifact=artifacts/words-of-word-lexicon-v0.1.0.sqlite --output=artifacts/words-of-word-lexicon-v0.2.0.sqlite --version=0.2.0 --work=work/shard-0.sqlite
```

Imported model responses are structurally validated educational definition drafts, not independently source-verified dictionary scholarship. Limits apply to file/line sizes, senses, examples, text, controls, and markup. Provider/model/revision/run/prompt envelopes must match. Merge binds every shard to the target artifact, rejects conflicts, validates a temporary copy, and atomically creates a new immutable filename.

Work databases, tasks, drafts, SQLite sidecars, and generated artifacts are excluded from Git and Docker context.

## Deployment note

Local Docker builds may include the ignored expanded `0.2.0` artifact in their build context. Remote Docker/Render builds expand the tracked compressed copy through `lexicon:ensure` and reject any checksum mismatch. Runtime keeps only the final expanded artifact plus production dependencies and still uses the in-memory gameplay index.
