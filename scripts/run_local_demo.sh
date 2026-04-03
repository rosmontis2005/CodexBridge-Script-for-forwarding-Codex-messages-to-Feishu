#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  npm install
fi

export APPROVAL_MODE="${APPROVAL_MODE:-terminal}"
export WORKSPACE_CWD="${WORKSPACE_CWD:-$ROOT}"
export CODEX_APPROVAL_POLICY="${CODEX_APPROVAL_POLICY:-untrusted}"
export CODEX_SANDBOX="${CODEX_SANDBOX:-workspace-write}"
export CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-low}"
export PROMPT="${PROMPT:-Run the shell command \`mkdir -p /tmp/codex-feishu-approval-demo\` and then tell me done.}"

echo "approval mode: $APPROVAL_MODE"
echo "workspace cwd: $WORKSPACE_CWD"
echo "prompt: $PROMPT"

npm run start -- --approval-mode "$APPROVAL_MODE" --cwd "$WORKSPACE_CWD" --prompt "$PROMPT"
