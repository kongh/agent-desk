#!/usr/bin/env bash
set -euo pipefail

vite --config apps/web/vite.config.ts --host 127.0.0.1 --port "${WEB_PORT:-5173}"
