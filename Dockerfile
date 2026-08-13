# Generic Docker deployment. The unpublished Phase-1 lexicon is built from
# pinned packages in the builder; switch to checksum-pinned fetch once released.
FROM node:22.23.0-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/lexicon/package.json packages/lexicon/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

# The same source also produces the separate Vercel portfolio. The Lightsail
# image is built as the game application, whose root route is GameHomePage.
ARG VITE_DEPLOYMENT_SURFACE=game
ENV VITE_DEPLOYMENT_SURFACE=$VITE_DEPLOYMENT_SURFACE

# The unpublished Phase-1 manifest has no remote URL; build deterministically from
# pinned local packages. A published manifest should replace this with lexicon:fetch.
RUN pnpm lexicon:build \
  && pnpm lexicon:validate \
  && pnpm --filter @wow/shared build \
  && pnpm --filter @wow/game-engine build \
  && pnpm --filter @wow/lexicon build \
  && pnpm --filter @wow/server build \
  && pnpm --filter @wow/web build

RUN pnpm deploy --legacy --filter @wow/server --prod /runtime \
  && mkdir -p /runtime/apps/server/dist /runtime/apps/web /runtime/packages/lexicon/artifacts \
  && cp -R apps/server/dist/. /runtime/apps/server/dist/ \
  && cp -R apps/web/dist /runtime/apps/web/dist \
  && cp packages/lexicon/artifacts/manifest.json packages/lexicon/artifacts/words-of-word-lexicon-v0.1.0.sqlite /runtime/packages/lexicon/artifacts/

FROM node:22.23.0-bookworm-slim AS runtime
WORKDIR /app
COPY --from=builder /runtime/ ./
ENV NODE_ENV=production \
    PORT=7860 \
    LEXICON_DB_PATH=/app/packages/lexicon/artifacts/words-of-word-lexicon-v0.1.0.sqlite \
    LEXICON_MANIFEST_PATH=/app/packages/lexicon/artifacts/manifest.json \
    ANALYTICS_AGGREGATE_FILE=/tmp/wow-analytics/aggregate-analytics.json
EXPOSE 7860
CMD ["node", "apps/server/dist/index.js"]
