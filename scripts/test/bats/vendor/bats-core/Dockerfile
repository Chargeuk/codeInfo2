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
ARG TINI_VERSION=v0.19.0
ARG TARGETPLATFORM
ARG LIBS_VER_SUPPORT=0.3.0
ARG LIBS_VER_FILE=0.4.0
ARG LIBS_VER_ASSERT=2.1.0
ARG LIBS_VER_DETIK=1.3.2
ARG UID=1001
ARG GID=115


# https://github.com/opencontainers/image-spec/blob/main/annotations.md
LABEL maintainer="Bats-core Team"
LABEL org.opencontainers.image.authors="Bats-core Team"
LABEL org.opencontainers.image.title="Bats"
LABEL org.opencontainers.image.description="Bash Automated Testing System"
LABEL org.opencontainers.image.url="https://hub.docker.com/r/bats/bats"
LABEL org.opencontainers.image.source="https://github.com/bats-core/bats-core"
LABEL org.opencontainers.image.base.name="docker.io/bash"

COPY ./docker /tmp/docker
# default to amd64 when not running in buildx environment that provides target platform
RUN /tmp/docker/install_tini.sh "${TARGETPLATFORM-linux/amd64}"
# Install bats libs
RUN /tmp/docker/install_libs.sh support ${LIBS_VER_SUPPORT}
RUN /tmp/docker/install_libs.sh file ${LIBS_VER_FILE}
RUN /tmp/docker/install_libs.sh assert ${LIBS_VER_ASSERT}
RUN /tmp/docker/install_libs.sh detik ${LIBS_VER_DETIK}

# Install parallel and accept the citation notice (we aren't using this in a
# context where it make sense to cite GNU Parallel).
RUN apk add --no-cache parallel ncurses && \
    mkdir -p ~/.parallel && touch ~/.parallel/will-cite \
    && mkdir /code

RUN ln -s "$(/usr/bin/env which bash)" "/bin/bash"

RUN ln -s /opt/bats/bin/bats /usr/local/bin/bats
COPY . /opt/bats/

WORKDIR /code/

ENTRYPOINT ["/tini", "--", "/usr/local/bin/bash", "/usr/local/bin/bats"]
