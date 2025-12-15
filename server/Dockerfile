FROM node:22-slim AS deps
WORKDIR /app
ENV HUSKY=0
COPY package*.json ./
COPY package-lock.json ./
COPY common/package*.json ./common/
COPY server/package*.json ./server/
COPY config.toml.example ./
COPY tsconfig*.json ./
COPY tsconfig.base.json ./
COPY common ./common
COPY server ./server
RUN npm ci --workspaces --include-workspace-root --ignore-scripts && npm install --workspaces --include-workspace-root --ignore-scripts --prefer-offline

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app .
RUN npm run build --workspace common && npm run build --workspace server

FROM node:22-slim AS runtime
# Install prerequisites
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Add Docker’s official GPG key
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up the Docker repository
RUN echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker CLI + Compose plugin
RUN apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin

WORKDIR /app/server
ENV HUSKY=0
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package*.json ./
COPY --from=build /app/config.toml.example /app/server/config.toml.example

# Set Playwright to use the browsers installed during build AFTER node_modules are in place to ensure the vcorrect version is used
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Install Playwright system dependencies and browsers
RUN npx playwright install-deps chromium
RUN npx playwright install chromium

ENV CODEINFO_CODEX_HOME=/app/codex
ENV PORT=5010
EXPOSE 5010
CMD ["node", "dist/index.js"]
