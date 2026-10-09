FROM node:22-bookworm-slim

RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages

RUN corepack prepare pnpm@10.33.3 --activate \
  && pnpm install --frozen-lockfile=false

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@nova/server", "start"]
