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

## Hotjar analytics

Set `VITE_HOTJAR_SITE_ID` in the production web environment (and optionally
`VITE_HOTJAR_VERSION`, which defaults to `6`). The site ID is public build-time
configuration, not a secret. Analytics load only in production, never on local
hosts, and can be disabled with `VITE_HOTJAR_ENABLED=false`.

The integration records anonymous, aggregate product events for navigation,
room creation and joins, game/round lifecycle, configured game settings, word
outcomes, reactions, betting, team selection, invites, and Daily Word outcomes.
It includes only coarse word-count and score buckets; it deliberately excludes
player names, room codes, submitted/source words, custom word lists, raw scores,
and raw error messages. Text inputs and gameplay
surfaces are suppressed from Hotjar recordings. On a configured production site,
the SDK does not load until the visitor explicitly allows analytics; their choice
is stored locally. Enable `VITE_HOTJAR_ENABLE_NATIVE=true` only after approving
tracking for Capacitor webviews. Deployments must still satisfy any additional
consent requirements for their jurisdictions.
