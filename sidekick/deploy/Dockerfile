# syntax=docker/dockerfile:1

# Build a static non-root sidekick binary. CGO must stay disabled so the
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
  -ldflags "-s -w -X github.com/dunsparce9/izci/sidekick/internal/version.Version=${VERSION}" \
  -o /out/izci-sidekick ./cmd/izci-sidekick

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 65532 --create-home --shell /usr/sbin/nologin sidekick
COPY --from=build /out/izci-sidekick /usr/local/bin/izci-sidekick
USER sidekick
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/izci-sidekick"]
CMD ["serve", "--config", "/etc/izci-sidekick/config.json"]
