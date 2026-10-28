FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates
COPY apps ./apps

# Cache-friendly: deps compile first via a dummy main, then the real source.
RUN mkdir -p apps/media-worker/src && \
    echo "fn main() {}" > apps/media-worker/src/main.rs && \
    cargo build --release && rm -rf apps/media-worker/src

COPY crates ./crates
COPY apps ./apps
RUN touch apps/media-worker/src/main.rs && cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --system --uid 1001 mediaworker

COPY --from=builder /build/target/release/media-worker /usr/local/bin/media-worker

USER mediaworker

CMD ["media-worker"]
