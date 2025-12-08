# Multi-stage build for Python ML Worker Service
FROM python:3.13-slim AS base

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency management
RUN pip install --no-cache-dir uv

# Copy kernel source
COPY kernels/core /app/kernels/core
COPY data /app/data

# Development stage
FROM base AS development

WORKDIR /app/kernels/core

# Install dependencies with uv
RUN uv pip install --system -e ".[dev]"

# Expose port
EXPOSE 9080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:9080/health || exit 1

# Run with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9080", "--reload"]

# Production stage
FROM base AS production

WORKDIR /app/kernels/core

# Install dependencies (production only)
RUN uv pip install --system .

# Run as non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 9080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:9080/health || exit 1

# Run with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9080"]
