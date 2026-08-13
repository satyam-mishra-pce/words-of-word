# Generic Docker deployment for free Docker hosts such as Hugging Face Spaces.
# The app is a single Node/Socket.IO server that also serves the built React app.
FROM node:22.23.0-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

# The same source also produces the separate Vercel portfolio. The Lightsail
# image is built as the game application, whose root route is GameHomePage.
ARG VITE_DEPLOYMENT_SURFACE=game
ENV VITE_DEPLOYMENT_SURFACE=$VITE_DEPLOYMENT_SURFACE

RUN pnpm --filter @wow/shared build \
  && pnpm --filter @wow/game-engine build \
  && pnpm --filter @wow/server build \
  && pnpm --filter @wow/web build

ENV NODE_ENV=production \
    PORT=7860 \
    ANALYTICS_AGGREGATE_FILE=/tmp/wow-analytics/aggregate-analytics.json

EXPOSE 7860

CMD ["node", "apps/server/dist/index.js"]
