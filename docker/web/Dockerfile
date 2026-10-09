FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
RUN corepack prepare pnpm@10.33.3 --activate \
  && pnpm install --frozen-lockfile=false \
  && pnpm --filter @nova/web build

FROM nginx:1.27-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
