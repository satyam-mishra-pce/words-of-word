# Contributor & agent contract

Rules that keep this codebase from silently regressing. Both humans and AI agents
must follow them. The most important one has automated enforcement.

## Game surface parity (enforced)

**Problem this solves:** the game is played on more than one *surface* — the
multiplayer room (`apps/web/src/pages/RoomPage.tsx`) and the single-player daily
run (`apps/web/src/pages/DailyWordPage.tsx`) — and historically every round
feature (sounds, definitions, timer behaviour, word-entry feedback) was built
into the room only and never reached daily. Features drifted apart constantly.

**The rule:** every game round feature lives in the shared core at
`apps/web/src/game/` and every surface consumes it. Never re-implement round
behaviour inside a page.

The shared core:

| Module | Responsibility (single source of truth) |
| --- | --- |
| `game/soundBus.ts` | The semantic event stream a surface emits (`roundStart`, `wordAccepted`, `timerTick`, …). |
| `game/useGameSounds.ts` | The **only** place events map to sounds — timer cadence, accept/reject classification, dedup. |
| `game/useWordDefinitions.ts` | The one cache + sheet + prefetch behaviour for word definitions. |
| `game/GameRound.tsx` | The shared round surface (source card, timer, word form, accepted chips, definition sheet). Slots carry surface-specific chrome. |

**When adding a round feature:**
1. Add it to the shared core in `src/game/` (a new sound event, a definition
   behaviour, a `GameRound` element/prop).
2. Both surfaces get it automatically. If a surface needs to opt a variant in,
   do it through a prop/slot on the shared core — do not fork the behaviour.
3. To play a sound, emit to the `soundBus` (`bus.emit(...)` / `bus.play(...)`).
   Never call `playGameSound(...)` from a page.

**Enforcement:** `apps/web/scripts/check-game-parity.mjs` runs as the first step
of `pnpm --filter @wow/web build` (so it also runs on every deploy). It fails the
build if any file that renders the round surface does not import the shared
`../game` core, or if a surface calls `playGameSound(...)` directly. New surfaces
are detected structurally, so forgetting the rule breaks the build rather than
shipping a divergence. Run it directly with `pnpm --filter @wow/web parity`.

## Lexicon completeness (enforced)

The runtime refuses to load any lexicon artifact that is not `release_status =
"complete"` with `missing_definition_count = 0` (see
`packages/lexicon/src/index.ts` → `verifyDatabase`). This prevents a partial
build (e.g. a WordNet-only artifact) from silently dropping definitions for
generated-only words on any server, including production. Do not weaken this
check; ship a complete artifact instead.
