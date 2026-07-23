#!/usr/bin/env bash

set -euo pipefail

usage() {
  printf '%s\n' \
    'Usage: run-codex-review.sh --base <commit> --model <model> --reasoning-effort <effort> --instructions-file <path> --output-file <path>' >&2
}

fail() {
  printf 'run-codex-review.sh: %s\n' "$1" >&2
  usage
  exit 2
}

comparison_base=''
review_model=''
reasoning_effort=''
instructions_file=''
output_file=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base)
      [ "$#" -ge 2 ] || fail '--base requires a value'
      comparison_base="$2"
      shift 2
      ;;
    --model)
      [ "$#" -ge 2 ] || fail '--model requires a value'
      review_model="$2"
      shift 2
      ;;
    --reasoning-effort)
      [ "$#" -ge 2 ] || fail '--reasoning-effort requires a value'
      reasoning_effort="$2"
      shift 2
      ;;
    --instructions-file)
      [ "$#" -ge 2 ] || fail '--instructions-file requires a value'
      instructions_file="$2"
      shift 2
      ;;
    --output-file)
      [ "$#" -ge 2 ] || fail '--output-file requires a value'
      output_file="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "${comparison_base}" ] || fail '--base is required'
[ -n "${review_model}" ] || fail '--model is required'
[ -n "${reasoning_effort}" ] || fail '--reasoning-effort is required'
[ -n "${instructions_file}" ] || fail '--instructions-file is required'
[ -n "${output_file}" ] || fail '--output-file is required'
[ -f "${instructions_file}" ] || fail "instructions file does not exist: ${instructions_file}"
[ -s "${instructions_file}" ] || fail "instructions file is empty: ${instructions_file}"

output_parent="$(dirname "${output_file}")"
[ -d "${output_parent}" ] || fail "output directory does not exist: ${output_parent}"

codex_bin="${CODEINFO_CODEX_BIN:-codex}"
if [[ "${codex_bin}" == */* ]]; then
  [ -x "${codex_bin}" ] || fail "Codex executable is not executable: ${codex_bin}"
elif ! command -v "${codex_bin}" >/dev/null 2>&1; then
  fail "Codex executable was not found: ${codex_bin}"
fi

review_instructions="$(<"${instructions_file}")"

exec "${codex_bin}" exec review \
  --dangerously-bypass-approvals-and-sandbox \
  --ephemeral \
  --model "${review_model}" \
  --base "${comparison_base}" \
  --config "model_reasoning_effort=\"${reasoning_effort}\"" \
  --config "developer_instructions=${review_instructions}" \
  --output-last-message "${output_file}" \
  </dev/null
