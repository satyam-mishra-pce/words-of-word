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
