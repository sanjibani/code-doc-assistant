FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
COPY .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
ENV NODE_ENV=production
ENV PORT=3000
# better-sqlite3 + sqlite-vec + tree-sitter ship prebuilt binaries for
# node 22 on debian. If the prebuilds miss, fall back to build tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/app ./app
# Writable data dir for sqlite.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
