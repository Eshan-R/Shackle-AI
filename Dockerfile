# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# ShackleAI Backend — Google Cloud Run
# ─────────────────────────────────────────────────────────────────────────────
# Build context: backend/ directory
#   docker build -t shackle-backend .
#   docker run -p 8080:8080 --env-file ../.env shackle-backend
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.13-slim

# ── Environment ──────────────────────────────────────────────────────────────
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ── System deps (slim image omits gcc; needed for some C-extension wheels) ───
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Install Python dependencies ───────────────────────────────────────────────
# Copy requirements first to leverage Docker layer cache:
# layer is only rebuilt when requirements.txt changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# ── Copy backend source ───────────────────────────────────────────────────────
COPY . .

# ── Cloud Run injects $PORT at runtime (default 8080) ────────────────────────
# Using shell form so ${PORT:-8080} is evaluated by the shell at startup.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]