# The separate MCP image must support --init-script in isolated sessions.
ARG CODEINFO_PLAYWRIGHT_MCP_BASE_IMAGE=mcr.microsoft.com/playwright/mcp:v0.0.83@sha256:690763cbb437ee7233f538a953bb5390bf03791eb5c965b471e59d17a6132fcb

FROM scratch AS corp_certs
COPY certs/empty-corp-ca/ /

FROM ${CODEINFO_PLAYWRIGHT_MCP_BASE_IMAGE}
USER root
ENV HOME=/home/node
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
COPY --from=corp_certs / /usr/local/share/ca-certificates/codeinfo-build/
RUN set -eu; \
    mkdir -p /etc/ssl/certs; \
    for cert in /usr/local/share/ca-certificates/codeinfo-build/*.crt; do \
      [ -f "$cert" ] || continue; \
      printf '\n' >> /etc/ssl/certs/ca-certificates.crt; \
      cat "$cert" >> /etc/ssl/certs/ca-certificates.crt; \
    done; \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3-tools openssl util-linux && \
    update-ca-certificates && rm -rf /var/lib/apt/lists/*
COPY browser /app/browser
COPY server/import-browser-certificates.sh /app/browser/import-browser-certificates.sh
RUN node -e "if (require('/app/package.json').version !== '0.0.83') process.exit(1)" && \
    node /app/browser/xr-init.mjs > /app/browser/xr-init.js && \
    chmod -R a+rX /app/browser
# The wrapper imports trust as root, then starts MCP with the configured UID/GID.
ENTRYPOINT ["sh", "/app/browser/entrypoint.sh"]
