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
RUN npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund
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
RUN apt-get update && apt-get install -y \
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
    openssl \
    openssh-client \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    unzip \
    zip \
    vim-tiny \
    nano \
    rsync \
    tzdata \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Debian installs fd-find as fdfind; provide fd for tooling expectations.
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd

# Align Chrome binary name for tooling that expects google-chrome.
RUN ln -s /usr/bin/chromium /usr/bin/google-chrome

# Add a small Python toolbox for agent automation (scripts, parsing, API calls).
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir \
      requests \
      pyyaml \
      toml \
      jsonschema \
      rich \
      python-dotenv

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/entrypoint.sh ./entrypoint.sh
COPY --from=build /app/config.toml.example /app/server/config.toml.example

# Set Playwright to use the browsers installed during build AFTER node_modules are in place to ensure the correct version is used
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Install Playwright system dependencies and browsers
RUN npx playwright install-deps chromium
RUN npx playwright install chromium

RUN npm install -g @openai/codex
RUN npm install -g mcp-remote
RUN npm install -g --force @upstash/context7-mcp
RUN npm install -g --force @mui/mcp@latest
RUN npm install -g --force @playwright/mcp@latest
RUN npm install -g --force chrome-devtools-mcp
RUN npm install -g git-credential-forwarder

# Use the forwarder for any user inside the container.
RUN git config --system credential.helper '!f(){ gcf-client $*; }; f'

ENV CODEINFO_CODEX_HOME=/app/codex
ENV PORT=5010
EXPOSE 5010
EXPOSE 9222
RUN chmod +x ./entrypoint.sh
CMD ["./entrypoint.sh"]
