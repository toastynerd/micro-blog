#!/usr/bin/env bash
# Print the AWS account the current credentials resolve to, and compare it to
# the account pinned in config.json. Run this BEFORE deploying so personal-site
# infra never lands in the wrong (e.g. client) account.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f config.json ]]; then
  echo "config.json not found. Copy config.example.json to config.json first." >&2
  exit 1
fi

want=$(node -e "process.stdout.write(require('./config.json').awsAccountId)")
echo "config.json awsAccountId : $want"

ident=$(aws sts get-caller-identity --output json)
have=$(node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).Account))" <<<"$ident")
arn=$(node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).Arn))" <<<"$ident")

echo "active AWS account       : $have"
echo "active identity          : $arn"

if [[ "$want" != "$have" ]]; then
  echo
  echo "MISMATCH: active account ($have) != config account ($want)." >&2
  echo "Switch profiles (e.g. export AWS_PROFILE=personal) and re-run." >&2
  exit 1
fi

echo
echo "OK — active account matches your personal account in config.json."
