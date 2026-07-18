#!/usr/bin/env bash
# FRESH-HISTORY PUBLIC EXPORT — the git history of this repo contains a leaked ElevenLabs key
# (confirmed), so the public repo MUST be a clean single-commit export, never a push of this
# history. This script builds the export locally and VERIFIES it holds no secrets. It does NOT
# push anywhere — publishing happens only after the user has rotated: ElevenLabs, MongoDB
# password, LangSmith.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HOME/forever-public-export}"

echo "== exporting $SRC -> $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

# Working tree only (never .git), excluding secrets, runtime data, deps, local notes.
rsync -a "$SRC/" "$OUT/" \
  --exclude '.git' \
  --exclude '.env' --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.data' \
  --exclude 'notes' \
  --exclude 'public/audio' \
  --exclude 'public/images/notebooks' \
  --exclude '*.log'

# The public repo needs an env TEMPLATE with every variable name and no values.
if [ -f "$SRC/.env.example" ]; then cp "$SRC/.env.example" "$OUT/.env.example"; fi

echo "== secret scan (fails loudly on any hit)"
PATTERNS=(
  'sk_[a-f0-9]\{40,\}'            # ElevenLabs-style
  'sk-[A-Za-z0-9]\{20,\}'         # DashScope/OpenAI-style
  'lsv2_pt_[a-f0-9]'              # LangSmith
  'mongodb+srv://[^<]'            # real Mongo URIs (template placeholders excluded by <)
  'AKID[A-Za-z0-9]\{16,\}'        # Alibaba AccessKey
)
FAIL=0
for p in "${PATTERNS[@]}"; do
  if grep -rIl --exclude='.env.example' --exclude='export-public-repo.sh' -e "$p" "$OUT" > /tmp/secret-hits.txt 2>/dev/null && [ -s /tmp/secret-hits.txt ]; then
    echo "!! SECRET PATTERN '$p' FOUND IN:"; cat /tmp/secret-hits.txt; FAIL=1
  fi
done
[ "$FAIL" -eq 1 ] && { echo "== EXPORT UNSAFE — fix before publishing"; exit 1; }
echo "== clean: no secret patterns in the export"

cd "$OUT"
git init -q
git add -A
git -c user.name="forever" -c user.email="forever@users.noreply.github.com" \
  commit -q -m "forever — AI course generator with verified visual dry runs (Qwen Cloud Global AI Hackathon, Track 3: Agent Society)"
echo "== single-commit repo ready at $OUT ($(git rev-parse --short HEAD))"
echo "== NEXT (manual, after key rotation): create the GitHub repo and push:"
echo "   cd $OUT && git remote add origin <repo-url> && git push -u origin main"
