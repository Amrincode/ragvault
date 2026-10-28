#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python="$root/backend/.venv/bin/python"
if [ ! -x "$python" ]; then
    printf '%s\n' 'Backend venv missing. Use python3.12 -m venv backend/.venv; install ./backend[dev].' >&2
    exit 1
fi
command=start
case "${1:-}" in
    --check) command=preflight ;;
    '') ;;
    *) printf '%s\n' 'Usage: sh scripts/start-dev.sh [--check]' >&2; exit 2 ;;
esac
cd "$root/backend"
exec "$python" -m app.dev "$command"
