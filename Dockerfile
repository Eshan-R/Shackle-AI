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

# ── System deps (added headers for C-extensions like evdev) ─────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        build-essential \
        linux-headers-generic \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Install Python dependencies ───────────────────────────────────────────────
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# ── Copy backend source ───────────────────────────────────────────────────────
COPY . .

# ── Cloud Run injects $PORT at runtime (default 8080) ────────────────────────
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
