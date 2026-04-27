FROM node:22-slim AS build
WORKDIR /app
ENV HUSKY=0
ARG VITE_CODEINFO_API_URL
ARG VITE_CODEINFO_LMSTUDIO_URL
ARG VITE_CODEINFO_LOG_FORWARD_ENABLED
ARG VITE_CODEINFO_LOG_MAX_BYTES
ARG CODEINFO_NPM_REGISTRY
ARG CODEINFO_NPM_FETCH_RETRIES=5
ARG CODEINFO_NPM_FETCH_RETRY_FACTOR=2
ARG CODEINFO_NPM_FETCH_RETRY_MINTIMEOUT=10000
ARG CODEINFO_NPM_FETCH_RETRY_MAXTIMEOUT=120000
ARG CODEINFO_NPM_FETCH_TIMEOUT=300000
ENV VITE_CODEINFO_API_URL=${VITE_CODEINFO_API_URL}
ENV VITE_CODEINFO_LMSTUDIO_URL=${VITE_CODEINFO_LMSTUDIO_URL}
ENV VITE_CODEINFO_LOG_FORWARD_ENABLED=${VITE_CODEINFO_LOG_FORWARD_ENABLED}
ENV VITE_CODEINFO_LOG_MAX_BYTES=${VITE_CODEINFO_LOG_MAX_BYTES}
COPY package*.json ./
COPY package-lock.json ./
COPY common/package*.json ./common/
COPY client/package*.json ./client/
COPY tsconfig*.json ./
COPY tsconfig.base.json ./
COPY common ./common
COPY client ./client
RUN set -eu; \
    if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then \
      echo "[CODEINFO][T04_BUILD][client] npm registry override enabled"; \
      NPM_CONFIG_REGISTRY="${CODEINFO_NPM_REGISTRY}" \
      NPM_CONFIG_FETCH_RETRIES="${CODEINFO_NPM_FETCH_RETRIES}" \
      NPM_CONFIG_FETCH_RETRY_FACTOR="${CODEINFO_NPM_FETCH_RETRY_FACTOR}" \
      NPM_CONFIG_FETCH_RETRY_MINTIMEOUT="${CODEINFO_NPM_FETCH_RETRY_MINTIMEOUT}" \
      NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT="${CODEINFO_NPM_FETCH_RETRY_MAXTIMEOUT}" \
      NPM_CONFIG_FETCH_TIMEOUT="${CODEINFO_NPM_FETCH_TIMEOUT}" \
      npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund; \
    else \
      echo "[CODEINFO][T04_BUILD][client] npm registry override disabled"; \
      NPM_CONFIG_FETCH_RETRIES="${CODEINFO_NPM_FETCH_RETRIES}" \
      NPM_CONFIG_FETCH_RETRY_FACTOR="${CODEINFO_NPM_FETCH_RETRY_FACTOR}" \
      NPM_CONFIG_FETCH_RETRY_MINTIMEOUT="${CODEINFO_NPM_FETCH_RETRY_MINTIMEOUT}" \
      NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT="${CODEINFO_NPM_FETCH_RETRY_MAXTIMEOUT}" \
      NPM_CONFIG_FETCH_TIMEOUT="${CODEINFO_NPM_FETCH_TIMEOUT}" \
      npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund; \
    fi
RUN set -eu; \
    client_npm_override="off"; \
    if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then \
      client_npm_override="on"; \
    fi; \
    printf 'CODEINFO_CLIENT_BUILD_OVERRIDE_STATE=client_npm=%s\n' "$client_npm_override" \
      > /app/client/.codeinfo-client-build-override-state.env
RUN npm run build --workspace client

FROM node:22-slim AS runtime
WORKDIR /app/client
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/client/dist ./dist
COPY --from=build /app/client/vite.config.ts ./vite.config.ts
COPY --from=build /app/client/src/config/previewAllowedHosts.ts ./src/config/previewAllowedHosts.ts
COPY --from=build /app/client/package*.json ./
COPY --from=build /app/client/.codeinfo-client-build-override-state.env ./.codeinfo-client-build-override-state.env
COPY client/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
ENV PORT=5001
EXPOSE 5001
ENTRYPOINT ["./entrypoint.sh"]
