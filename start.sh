#!/bin/bash
set -e
cd "$(dirname "$0")"

# Install dependencies if needed
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "Installing dependencies..."
  pip3 install -r requirements.txt --break-system-packages 2>/dev/null \
    || pip install -r requirements.txt
fi

echo "Starting StreamX on http://localhost:8000"
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
