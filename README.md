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

## First-party product analytics

The server has a built-in, zero-third-party product observatory for understanding
how people discover, return to, and play the game. It combines authoritative
server-side game measurements with a random, pseudonymous browser installation
ID and per-app-session ID. The raw IDs are HMAC-pseudonymized before server
storage and are not returned by the report.
This makes exact DAU/WAU/MAU-style activity, D1/D7/D30 return rates, session
counts, feature adoption, and play-depth metrics possible without accounts.

The observatory measures successful room creation/joining, room fill and size,
game starts/finishes/abandons, round depth, game/player duration, departures,
accepted words as a count, settings/mode adoption, feature use, and UTC peak
activity. It deliberately does **not** store or display player names, room
codes, typed words, custom lists, scores, IP addresses, user-agent strings,
raw socket IDs, replay recordings, or raw event payloads. Browser Do Not Track
and Global Privacy Control remain an opt-out for the optional pseudonymous
client measurement; server-authoritative aggregate game totals still work.

Opening `/admin/analytics` in a browser displays a full private dashboard with
traffic, retention, funnels, room health, engagement, drop-off, UTC heatmaps,
mode adoption, feature adoption, and settings charts. Set a strong
`ANALYTICS_TOKEN` in the server environment; enter that value once to create an
`HttpOnly`, `SameSite=Strict`, session-only admin cookie. It is not a player
tracking cookie, carries no report data, is never put in a URL, and can be
cleared with **End session**. Programmatic access remains available without
putting the token in a URL:

```bash
curl -H "Authorization: Bearer $ANALYTICS_TOKEN" \
  https://your-domain.example/admin/analytics
```

The endpoint is unavailable when no token is configured and responses use
`Cache-Control: no-store`. Analytics are atomically written to
`ANALYTICS_AGGREGATE_FILE`, defaulting to `logs/aggregate-analytics.json`. The
file includes compact pseudonymous retention profiles for the most recent 120
days; it does not include raw visitor IDs. Render's free filesystem is
ephemeral, so all history resets on a deploy/restart unless that path is backed
by durable storage. Download reports regularly if running on the free plan.

If this project was deployed with the older detailed analytics implementation,
remove its legacy `logs/game-analytics.jsonl` file from deployment storage: it
may contain data that the current implementation intentionally no longer
collects.
