FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml constraints-container.txt ./
COPY app ./app
RUN python -m pip install --no-cache-dir -c constraints-container.txt pip==26.2.2 \
    && python -m pip install --no-cache-dir -c constraints-container.txt . \
    && useradd --create-home ragvault \
    && mkdir -p /app/data/uploads && chown -R ragvault:ragvault /app/data
COPY alembic.ini ./
COPY alembic ./alembic

USER ragvault
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('BACKEND_PORT', '8000') + '/', timeout=3)"
CMD ["python", "-m", "app"]
