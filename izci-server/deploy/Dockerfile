# syntax=docker/dockerfile:1

# Build a static non-root server binary. CGO must stay disabled so the
# final image runs without libc.
ARG GO_VERSION=1.27.1
ARG VERSION=dev

FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
ARG VERSION
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
  -ldflags "-s -w -X github.com/tozworth/izci/izci-server/internal/version.Version=${VERSION}" \
  -o /out/izci-server ./cmd/izci-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg libopenmpt0 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 65532 --create-home --shell /usr/sbin/nologin izci-server \
  && install -d -o izci-server -g izci-server /var/lib/izci-server /var/cache/izci-server /srv/izci-server/music
COPY --from=build /out/izci-server /usr/local/bin/izci-server
COPY LICENSE.md THIRD-PARTY-NOTICES.md /usr/share/doc/izci-server/
USER izci-server
EXPOSE 8787
VOLUME ["/var/lib/izci-server", "/var/cache/izci-server", "/srv/izci-server/music"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8787/readyz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/izci-server"]
CMD ["serve", "--config", "/etc/izci-server/config.json"]
