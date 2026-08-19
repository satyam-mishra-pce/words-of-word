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

## Analytics: every feature is tracked (guardrail)

**Problem this solves:** the whole product decision loop runs on the analytics
dashboard. It is an event-sourced stream in Supabase (`public.analytics_event`),
aggregated over a time window by the admin page (`/admin/analytics`). Features
that aren't instrumented are invisible, so we decide what to build next from
half the data. The rule: **no new feature ships untracked.**

**The contract**

- Every trackable behaviour is emitted, nothing is optional:
  - **Server / game lifecycle** (rooms, games, rounds, words, emotes, bets,
    teams, departures, feature usage) → add/keep a `record*` on
    `apps/server/src/supabaseAnalytics.ts` and call it from `index.ts`. Each
    `record*` emits one row into `public.analytics_event` (column `event`),
    carrying its dimensions in `props` so the SQL aggregates can slice it by any
    time window and any prop.
  - **Client UI** (pages, buttons, menus, toggles, share, settings, auth) → call
    `track('event_name', props)` / `trackPage` / `trackUi` from
    `apps/web/src/services/analytics.ts`, or tag the element with
    `data-analytics="label"` to be auto-captured by the global click listener.
- New events go into the same flat `analytics_event` stream — no new tables, no
  per-feature storage. Pick a **snake_case** event name and put any filterable
  dimension in `props` (e.g. `mode`, `settings`, `bucket`).
- The admin dashboard aggregates from the stream automatically: adding an
  event is enough for it to appear in “All events” and any `props` key can be
  surfaced via `analytics_grouped`. If a new dimension deserves a first-class
  card, add the breakdown key in `supabaseAnalytics.ts → report()` and a
  `<BreakdownSection>` in `apps/web/src/pages/AnalyticsPage.tsx`.
- Privacy: users are **opted in by default**. Do not silently bypass the opt-out
  (`isAnalyticsEnabled()` in `apps/web/src/services/analytics.ts`); a user who
  opted out must stay untracked on that installation.

**When adding a round feature (both surfaces),** track it too: server round
events via the shared store, client UI via `track`/`data-analytics`. Check the
admin dashboard for the selected window to confirm the new event is flowing.
