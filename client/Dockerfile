FROM node:22-slim AS build
WORKDIR /app
ENV HUSKY=0
ARG VITE_API_URL
ARG VITE_LMSTUDIO_URL
ARG CODEINFO_NPM_REGISTRY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_LMSTUDIO_URL=${VITE_LMSTUDIO_URL}
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
      NPM_CONFIG_REGISTRY="${CODEINFO_NPM_REGISTRY}" npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund; \
    else \
      echo "[CODEINFO][T04_BUILD][client] npm registry override disabled"; \
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
COPY --from=build /app/client/package*.json ./
COPY --from=build /app/client/.codeinfo-client-build-override-state.env ./.codeinfo-client-build-override-state.env
COPY client/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
ENV CODEINFO_CLIENT_BUILD_OVERRIDE_STATE="client_npm=off"
ENV PORT=5001
EXPOSE 5001
ENTRYPOINT ["./entrypoint.sh"]
