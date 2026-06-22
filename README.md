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
