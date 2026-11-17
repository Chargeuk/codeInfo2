# The separate MCP image must support --init-script in isolated sessions.
FROM mcr.microsoft.com/playwright/mcp:v0.0.83@sha256:690763cbb437ee7233f538a953bb5390bf03791eb5c965b471e59d17a6132fcb
USER root
COPY browser /app/browser
RUN apt-get update && \
    apt-get install -y --no-install-recommends libegl1 libegl-mesa0 libgles2 && \
    rm -rf /var/lib/apt/lists/* && \
    node -e "if (require('/app/package.json').version !== '0.0.83') process.exit(1)" && \
    node /app/browser/xr-init.mjs > /app/browser/xr-init.js && \
    chmod -R a+rX /app/browser
USER node
