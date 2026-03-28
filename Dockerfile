# ============================================================================
# Fortis RWA - Production Dockerfile
# Multi-stage build for minimal production image
# ============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM rust:1.92-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Build from the monorepo root while compiling the backend crate
WORKDIR /app

# Copy backend manifests first for better layer caching
COPY backend/Cargo.toml ./backend/Cargo.toml
COPY backend/Cargo.lock ./backend/Cargo.lock

# Copy backend source tree
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
COPY backend/benches ./backend/benches

# Build release binary
WORKDIR /app/backend
RUN cargo build --release --locked --features real-blockchain

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies
# - ca-certificates: Required for HTTPS connections (Solana RPC, Range API)
# - libssl3: Required for TLS/SSL connections
# - curl: Required for HEALTHCHECK
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

# Create non-root user for security
RUN useradd -r -s /bin/false appuser

# Set working directory
WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/backend/target/release/fortis-rwa-backend /app/fortis-rwa-backend

# Copy migrations (needed for SQLx runtime migrations)
COPY --from=builder /app/backend/migrations /app/migrations

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Set environment defaults
ENV RUST_LOG=info,tower_http=debug,sqlx=warn
ENV HOST=0.0.0.0
ENV PORT=3000

# Run the binary
ENTRYPOINT ["/app/fortis-rwa-backend"]
