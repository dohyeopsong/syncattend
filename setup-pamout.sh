#!/usr/bin/env bash
# Pamout 개인 키 공통 설치기: Claude Code / Codex CLI / OpenCode 1.x
# 키가 포함되지 않은 공개 파일입니다. 기존 파일은 설치 시 백업합니다.
set -euo pipefail
command -v python3 >/dev/null || { echo 'Python 3.9 이상을 먼저 설치하세요.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl을 먼저 설치하세요.' >&2; exit 1; }
setup_file=$(mktemp)
trap 'rm -f "$setup_file"' EXIT
curl --fail --silent --show-error --max-time 30 https://signup.pamout.com/pamout-cli.py -o "$setup_file"
python3 "$setup_file" install
