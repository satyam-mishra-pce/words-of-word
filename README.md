# Words of Word

A type-safe multiplayer word game built as a pnpm monorepo.

## Structure

```txt
apps/web          React + Vite client
apps/server       Fastify + Socket.IO server
packages/shared   Shared event contracts, schemas, and DTOs
packages/game-engine Pure word-game logic
```

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

The web app runs on port 3000 and the socket server runs on port 4000 by default.

## iOS and Android

The React app is packaged with Capacitor in `apps/web/ios` and `apps/web/android`.

```bash
cp apps/web/.env.mobile.example apps/web/.env.mobile
# Set public HTTPS VITE_SOCKET_URL and VITE_PUBLIC_WEB_URL first.
pnpm mobile:sync
pnpm mobile:ios
pnpm mobile:android
```

See [the mobile delivery guide](docs/MOBILE.md) for deep links, push credentials, device QA, and release setup.

## First-party aggregate analytics

The server has a built-in, zero-third-party product report for understanding
which modes and features are actually used. It stores counters only—analytics
uses no tracking cookies, replay recordings, user profiles, IP addresses, device
IDs, player names, room IDs, words, custom word lists, scores, raw errors, or
event history.

Authoritative server counters cover successful room creation/joining, quick
matchmaking, settings changes, starts, finishes, abandons, rounds, accepted
words, restarts, team changes, bets, and emotes. The report groups actual games
by mode and uses only bounded gameplay settings selected at game start. The
small client-side supplement sends fixed enum names only for client-only
features such as Daily Word, invite copies, rules/history, themes, and page
views; it is production-only and respects Do Not Track and Global Privacy Control. These are aggregate
usage counts—not unique-player, retention, or demographic measurements.

Set a strong `ANALYTICS_TOKEN` in the server environment. Opening
`/admin/analytics` in a browser displays a password prompt; enter that same token
once to create an `HttpOnly`, `SameSite=Strict`, session-only admin cookie. It is
not an analytics/tracking cookie, carries no report data, is never put in a URL,
and can be cleared with **End session**. Programmatic access remains available
without putting the token in a URL:

```bash
curl -H "Authorization: Bearer $ANALYTICS_TOKEN" \
  https://your-domain.example/admin/analytics
```

The endpoint is unavailable when no token is configured and responses use
`Cache-Control: no-store`. Aggregates are atomically written to
`ANALYTICS_AGGREGATE_FILE`, defaulting to `logs/aggregate-analytics.json`.
Render's free filesystem is ephemeral, so counters reset on a deploy/restart
unless that path is backed by durable storage; download reports regularly if
running on the free plan.

If this project was deployed with the older detailed analytics implementation,
remove its legacy `logs/game-analytics.jsonl` file from the deployment storage:
it may contain data that the aggregate implementation intentionally no longer
collects.
