# syntax=docker/dockerfile:1.7
# `node:22-slim` floated to 22.22.1 and started breaking the pinned
# `tree-sitter@0.21.1` native rebuild during `npm ci`. Pin the image to the
# repo's validated 22.21.1 patch level until the tree-sitter stack is upgraded.
FROM node:22.21.1-slim AS deps
WORKDIR /app
ARG CODEINFO_NPM_REGISTRY
ARG CODEINFO_PIP_INDEX_URL
ARG CODEINFO_PIP_TRUSTED_HOST
ARG CODEINFO_NODE_EXTRA_CA_CERTS
ENV HUSKY=0
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY package-lock.json ./
COPY common/package*.json ./common/
COPY server/package*.json ./server/
RUN set -eu; \
    if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then \
      echo "[CODEINFO][T03_BUILD][deps] npm registry override enabled"; \
      NPM_CONFIG_REGISTRY="${CODEINFO_NPM_REGISTRY}" npm ci --workspaces --include-workspace-root --no-audit --no-fund; \
    else \
      echo "[CODEINFO][T03_BUILD][deps] npm registry override disabled"; \
      npm ci --workspaces --include-workspace-root --no-audit --no-fund; \
    fi
FROM node:22.21.1-slim AS build
WORKDIR /app
ENV HUSKY=0
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/server/node_modules /app/server/node_modules
COPY package*.json ./
COPY package-lock.json ./
COPY common/package*.json ./common/
COPY server/package*.json ./server/
COPY config.toml.example ./
COPY tsconfig*.json ./
COPY tsconfig.base.json ./
COPY common ./common
COPY server ./server
RUN npm run build --workspace common && npm run build --workspace server

FROM node:22.21.1-slim AS runtime
ARG HOME
ARG CODEINFO_NPM_REGISTRY
ARG CODEINFO_PIP_INDEX_URL
ARG CODEINFO_PIP_TRUSTED_HOST
ARG CODEINFO_NODE_EXTRA_CA_CERTS
RUN mkdir -p ${HOME}/tmp
RUN mkdir -p ${HOME}/.docker
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

# Add HashiCorp's official GPG key and apt repository for Terraform CLI.
RUN curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /etc/apt/keyrings/hashicorp.gpg
RUN echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com \
  $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/hashicorp.list > /dev/null

# Install Docker CLI + Compose plugin
RUN apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin

WORKDIR /app/server
ENV HUSKY=0
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y \
    curl \
    git \
    git-lfs \
    jq \
    netcat-openbsd \
    ripgrep \
    fd-find \
    bat \
    tree \
    less \
    procps \
    iproute2 \
    dnsutils \
    diffutils \
    openssl \
    openssh-client \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    unzip \
    util-linux \
    zip \
    vim-tiny \
    nano \
    rsync \
    terraform \
    tzdata \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Debian installs fd-find as fdfind; provide fd for tooling expectations.
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd

# Align Chrome binary name for tooling that expects google-chrome.
RUN ln -s /usr/bin/chromium /usr/bin/google-chrome

# Add Python tooling in an isolated, cacheable layer.
COPY server/requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eu; \
    if [ -n "${CODEINFO_PIP_INDEX_URL:-}" ] || [ -n "${CODEINFO_PIP_TRUSTED_HOST:-}" ]; then \
      echo "[CODEINFO][T03_BUILD][runtime] pip override enabled"; \
      if [ -n "${CODEINFO_PIP_INDEX_URL:-}" ] && [ -n "${CODEINFO_PIP_TRUSTED_HOST:-}" ]; then \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages --upgrade pip && \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages -r /tmp/requirements.txt; \
      elif [ -n "${CODEINFO_PIP_INDEX_URL:-}" ]; then \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" \
          python3 -m pip install --break-system-packages --upgrade pip && \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" \
          python3 -m pip install --break-system-packages -r /tmp/requirements.txt; \
      else \
        PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages --upgrade pip && \
        PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages -r /tmp/requirements.txt; \
      fi; \
    else \
      echo "[CODEINFO][T03_BUILD][runtime] pip override disabled"; \
      python3 -m pip install --break-system-packages --upgrade pip && \
      python3 -m pip install --break-system-packages -r /tmp/requirements.txt; \
    fi

# Install global CLI tooling in a cacheable layer.
COPY server/npm-global.txt /tmp/npm-global.txt
RUN --mount=type=cache,target=/root/.npm \
    set -eu; \
    if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then \
      echo "[CODEINFO][T03_BUILD][runtime] npm registry override enabled"; \
      NPM_CONFIG_REGISTRY="${CODEINFO_NPM_REGISTRY}" xargs -r npm install -g --force < /tmp/npm-global.txt; \
    else \
      echo "[CODEINFO][T03_BUILD][runtime] npm registry override disabled"; \
      xargs -r npm install -g --force < /tmp/npm-global.txt; \
    fi

RUN set -eu; \
    npm_override=off; \
    pip_index_override=off; \
    pip_trusted_host_override=off; \
    if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then \
      npm_override=on; \
    fi; \
    if [ -n "${CODEINFO_PIP_INDEX_URL:-}" ]; then \
      pip_index_override=on; \
    fi; \
    if [ -n "${CODEINFO_PIP_TRUSTED_HOST:-}" ]; then \
      pip_trusted_host_override=on; \
    fi; \
    printf 'CODEINFO_SERVER_BUILD_OVERRIDE_STATE=npm=%s;pip_index=%s;pip_trusted_host=%s\n' \
      "$npm_override" \
      "$pip_index_override" \
      "$pip_trusted_host_override" \
      > /app/server/.codeinfo-server-build-override-state.env

COPY --from=build /app/node_modules /app/node_modules
COPY --from=deps /app/server/node_modules /app/server/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/src/ast/queries ./src/ast/queries
COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/entrypoint.sh ./entrypoint.sh
COPY --from=build /app/config.toml.example /app/server/config.toml.example
COPY codex_agents /app/codex_agents
COPY flows /app/flows
COPY flows-sandbox /app/flows-sandbox
COPY e2e/fixtures /fixtures
COPY e2e/fixtures/repo /data

# Set Playwright to use the browsers installed during build.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Install Playwright system dependencies and browsers using the repo-pinned version.
RUN npx playwright install-deps chromium
RUN npx playwright install chromium

# Use the forwarder for any user inside the container.
RUN git config --system credential.helper '!f(){ gcf-client $*; }; f'

# Prepare the mutable Codex home even when the gitignored repo-local directory is absent.
RUN mkdir -p /app/codex && chmod 777 /app/codex

# Make HOME and all subfolders read/write for all users
RUN chmod -R 777 "${HOME}"
ENV CODEINFO_CODEX_HOME=/app/codex
ENV CODEINFO_SERVER_PORT=5010
ENV NPM_CONFIG_SCRIPT_SHELL=/bin/bash
EXPOSE 5010
EXPOSE 9222
RUN chmod +x ./entrypoint.sh
CMD ["./entrypoint.sh"]
