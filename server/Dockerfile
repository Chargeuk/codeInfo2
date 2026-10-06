# syntax=docker/dockerfile:1.7
ARG OPEN_CODE_REVIEW_REPOSITORY=https://github.com/Chargeuk/open-code-review.git
ARG OPEN_CODE_REVIEW_REF=codex/fix-codex-owned-review
ARG OPEN_CODE_REVIEW_COMMIT=a93c4868a4b8b3adfb20895a1e0c3a95333b3ae9

FROM golang:1.25.12-bookworm AS open-code-review-build
ARG OPEN_CODE_REVIEW_REPOSITORY
ARG OPEN_CODE_REVIEW_REF
ARG OPEN_CODE_REVIEW_COMMIT
WORKDIR /src
RUN set -eu; \
    git init; \
    git remote add origin "${OPEN_CODE_REVIEW_REPOSITORY}"; \
    git fetch --depth=1 origin "refs/heads/${OPEN_CODE_REVIEW_REF}"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${OPEN_CODE_REVIEW_COMMIT}"
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    set -eu; \
    mkdir -p /out; \
    CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.Version=codex-${OPEN_CODE_REVIEW_COMMIT} -X main.GitCommit=${OPEN_CODE_REVIEW_COMMIT}" \
      -o /out/ocr ./cmd/opencodereview

# `node:22-slim` floated to 22.22.1 and started breaking the pinned
# `tree-sitter@0.21.1` native rebuild during `npm ci`. Pin the image to the
# repo's validated 22.21.1 patch level until the tree-sitter stack is upgraded.
FROM node:22.21.1-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c AS deps
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
RUN --mount=type=cache,target=/root/.npm \
    set -eu; \
    if [ -n "${CODEINFO_NPM_REGISTRY:-}" ]; then \
      echo "[CODEINFO][T03_BUILD][deps] npm registry override enabled"; \
      NPM_CONFIG_REGISTRY="${CODEINFO_NPM_REGISTRY}" npm ci --workspaces --include-workspace-root --no-audit --no-fund; \
    else \
      echo "[CODEINFO][T03_BUILD][deps] npm registry override disabled"; \
      npm ci --workspaces --include-workspace-root --no-audit --no-fund; \
    fi
FROM node:22.21.1-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c AS build
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

FROM node:22.21.1-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c AS runtime
ARG GH_VERSION=2.94.0
ARG CODEINFO_NPM_REGISTRY
ARG CODEINFO_PIP_INDEX_URL
ARG CODEINFO_PIP_TRUSTED_HOST
ARG CODEINFO_NODE_EXTRA_CA_CERTS
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

# Install the pinned GitHub CLI release directly so builds do not depend on the
# package repository's release lag.
RUN set -eu; \
    GH_ARCH="$(dpkg --print-architecture)"; \
    case "${GH_ARCH}" in \
      amd64|arm64) ;; \
      *) echo "Unsupported GitHub CLI architecture: ${GH_ARCH}" >&2; exit 1 ;; \
    esac; \
    GH_ARCHIVE="gh_${GH_VERSION}_linux_${GH_ARCH}"; \
    curl -fsSL \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_ARCHIVE}.tar.gz" \
      -o /tmp/gh.tar.gz; \
    tar -xzf /tmp/gh.tar.gz -C /tmp; \
    install -m 0755 "/tmp/${GH_ARCHIVE}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tar.gz "/tmp/${GH_ARCHIVE}"; \
    gh --version

# Install Docker CLI + Compose plugin
RUN apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin

WORKDIR /app/server
ENV HUSKY=0
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eu; \
    apt-get update; \
    apt-get install -y \
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
    build-essential \
    xz-utils \
    pkg-config \
    libssl-dev \
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
    chromium; \
    gh --version; \
    rm -rf /var/lib/apt/lists/*

# Debian installs fd-find as fdfind; provide fd for tooling expectations.
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd

# Align Chrome binary name for tooling that expects google-chrome.
RUN ln -s /usr/bin/chromium /usr/bin/google-chrome

# Add Python tooling in an isolated, cacheable layer.
ARG PIP_VERSION=26.2.1
COPY server/requirements.txt server/requirements-constraints.txt /tmp/
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eu; \
    if [ -n "${CODEINFO_PIP_INDEX_URL:-}" ] || [ -n "${CODEINFO_PIP_TRUSTED_HOST:-}" ]; then \
      echo "[CODEINFO][T03_BUILD][runtime] pip override enabled"; \
      if [ -n "${CODEINFO_PIP_INDEX_URL:-}" ] && [ -n "${CODEINFO_PIP_TRUSTED_HOST:-}" ]; then \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages "pip==${PIP_VERSION}" && \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages -c /tmp/requirements-constraints.txt -r /tmp/requirements.txt; \
      elif [ -n "${CODEINFO_PIP_INDEX_URL:-}" ]; then \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" \
          python3 -m pip install --break-system-packages "pip==${PIP_VERSION}" && \
        PIP_INDEX_URL="${CODEINFO_PIP_INDEX_URL}" \
          python3 -m pip install --break-system-packages -c /tmp/requirements-constraints.txt -r /tmp/requirements.txt; \
      else \
        PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages "pip==${PIP_VERSION}" && \
        PIP_TRUSTED_HOST="${CODEINFO_PIP_TRUSTED_HOST}" \
          python3 -m pip install --break-system-packages -c /tmp/requirements-constraints.txt -r /tmp/requirements.txt; \
      fi; \
    else \
      echo "[CODEINFO][T03_BUILD][runtime] pip override disabled"; \
      python3 -m pip install --break-system-packages "pip==${PIP_VERSION}" && \
      python3 -m pip install --break-system-packages -c /tmp/requirements-constraints.txt -r /tmp/requirements.txt; \
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

COPY --from=open-code-review-build /out/ocr /usr/local/bin/ocr
RUN ocr --version && \
    ocr agent prepare --help >/dev/null && \
    ocr agent context read --help >/dev/null && \
    ocr agent validate-comments --help >/dev/null && \
    ocr agent report --help >/dev/null

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

# Stable tool layers depend only on version/checksum inputs, not app source or HOME.
ARG TARGETARCH
ARG RUSTUP_VERSION=1.29.1
ARG RUST_VERSION=1.99.0
ARG WASM_PACK_VERSION=0.15.0
ARG WASM_BINDGEN_VERSION=0.2.129
ARG BINARYEN_VERSION=133
ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/opt/wasm-tools/bin:/opt/binaryen/bin:${PATH}
COPY server/toolchain-checksums.txt server/install-rust-toolchain.sh /tmp/
RUN sh /tmp/install-rust-toolchain.sh
COPY server/prepare-rust-homes.sh /usr/local/bin/codeinfo-prepare-rust-homes
RUN chmod 755 /usr/local/bin/codeinfo-prepare-rust-homes

# Invoke only the locked CLI. Browser files and apt-installed OS libs persist in image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=deps /app/node_modules/playwright /opt/playwright/node_modules/playwright
COPY --from=deps /app/node_modules/playwright-core /opt/playwright/node_modules/playwright-core
RUN node -e "if (require('/opt/playwright/node_modules/playwright/package.json').version !== '1.56.1') process.exit(1)" && \
    node /opt/playwright/node_modules/playwright/cli.js install --with-deps chromium

# Runtime ownership is deliberately after expensive installs.
ARG HOME=/app/codex
ARG CODEINFO_RUNTIME_UID=1000
ARG CODEINFO_RUNTIME_GID=1000
RUN mkdir -p "${HOME}" "${HOME}/tmp" "${HOME}/.docker" && \
    chown "${CODEINFO_RUNTIME_UID}:${CODEINFO_RUNTIME_GID}" "${HOME}" "${HOME}/tmp" "${HOME}/.docker"

COPY --from=build /app/node_modules /app/node_modules
COPY --from=deps /app/server/node_modules /app/server/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/src/ast/queries ./src/ast/queries
COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/entrypoint.sh ./entrypoint.sh
COPY --from=build /app/config.toml.example /app/server/config.toml.example
COPY AGENTS.md /app/AGENTS.md
COPY planning /app/planning
COPY scripts /app/scripts
COPY codex_agents /app/codex_agents
RUN cp -R /app/codex_agents /app/codeinfo_agents
COPY flows /app/flows
COPY flows-sandbox /app/flows-sandbox
COPY e2e/fixtures /fixtures
COPY e2e/fixtures/repo /data

# Use the forwarder for any user inside the container.
RUN git config --system credential.helper '!f(){ gcf-client $*; }; f'

# Prepare the mutable provider homes even when the gitignored repo-local directories are absent.
RUN mkdir -p /app/codex/.agents/skills /app/copilot /app/lmstudio && chmod -R 777 /app/codex /app/copilot /app/lmstudio
ENV HOME=/app/codex
ENV CODEX_HOME=/app/codex
ENV CODEINFO_CODEX_HOME=/app/codex
ENV CODEINFO_COPILOT_HOME=/app/copilot
ENV CODEINFO_LMSTUDIO_HOME=/app/lmstudio
ENV CODEINFO_SERVER_PORT=5010
ENV NPM_CONFIG_SCRIPT_SHELL=/bin/bash
EXPOSE 5010
EXPOSE 9222
RUN chmod +x ./entrypoint.sh
CMD ["./entrypoint.sh"]
