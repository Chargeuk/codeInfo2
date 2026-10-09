# syntax=docker/dockerfile:1
ARG bashver=latest

# corp_certs is empty unless overridden with --build-context corp_certs=PATH.
FROM scratch AS corp_certs
COPY certs/empty-corp-ca/ /

FROM bash:${bashver}

COPY --from=corp_certs / /usr/local/share/ca-certificates/codeinfo-build/
# Bootstrap HTTPS package downloads before installing the CA management tools.
RUN set -eu; \
    mkdir -p /etc/ssl/certs; \
    for cert in /usr/local/share/ca-certificates/codeinfo-build/*.crt; do \
      [ -f "$cert" ] || continue; \
      printf '\n' >> /etc/ssl/certs/ca-certificates.crt; \
      cat "$cert" >> /etc/ssl/certs/ca-certificates.crt; \
    done; \
    apk add --no-cache ca-certificates; \
    update-ca-certificates

# Install parallel and accept the citation notice (we aren't using this in a
# context where it make sense to cite GNU Parallel).
RUN echo "@edgecomm http://dl-cdn.alpinelinux.org/alpine/edge/community"  >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache parallel ncurses shellcheck@edgecomm && \
    mkdir -p ~/.parallel && touch ~/.parallel/will-cite && \
    curl -sSfL https://github.com/shenwei356/rush/releases/download/v0.5.0/rush_linux_amd64.tar.gz | tar xzf - -C /usr/local/bin && \
    chmod +x /usr/local/bin/rush

RUN ln -s /opt/bats/bin/bats /usr/sbin/bats
COPY . /opt/bats/

ENTRYPOINT ["bash", "/usr/sbin/bats"]
