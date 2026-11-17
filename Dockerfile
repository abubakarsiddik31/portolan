# syntax=docker/dockerfile:1

# Build the workspace and produce a self-contained CLI deployment.
FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY bench/package.json ./bench/package.json

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @abubakarsiddiik/cli deploy --prod --legacy /out

# Runtime: Chromium is the only system dependency the substrate needs.
FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# The wrapper owns the sandbox flag. It defaults to --no-sandbox, which the
# default Docker seccomp profile requires; PORTOLAN_CHROME_SANDBOX=1 drops it
# for a host that permits user namespaces.
COPY docker/chromium.sh /usr/local/bin/chromium-portolan
RUN chmod +x /usr/local/bin/chromium-portolan

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/local/bin/chromium-portolan
ENV PORTOLAN_CHROME_SANDBOX=0

COPY --from=build /out /app
COPY LICENSE /app/LICENSE

# The working directory holds the config, maps, policies, skills, and database.
RUN mkdir -p /data/maps /data/policies /data/skills \
  && chown -R node:node /data /app

WORKDIR /data
USER node

EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4200)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "/app/dist/bin.js"]
CMD ["serve"]
