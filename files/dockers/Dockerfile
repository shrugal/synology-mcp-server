# Multi-stage Dockerfile for synology-office-mcp
# Build: docker build -t synology-office-mcp:0.2.0 -f files/dockers/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
# Pin pnpm: corepack's floating default (pnpm 12+) aborts the install with
# ERR_PNPM_IGNORED_BUILDS because esbuild's postinstall is not pre-approved.
ENV HUSKY=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
# --ignore-scripts: prune drops husky (a devDependency) and then re-runs the
# root `prepare` script, which would fail with "husky: not found".
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
