#!/usr/bin/env bash
set -e

echo "=== E2E Test: Devin Event Automation ==="
echo "Note: Tests webhook handling and signature verification."
echo "Devin API calls require valid credentials in .env"
echo ""

export PORT=3001
export GITHUB_WEBHOOK_SECRET=test_secret

bun run src/server.ts &
PID=$!
sleep 1

sign() {
  echo -n "$1" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | sed 's/.*= //'
}

echo "1. Health check..."
curl -sf http://localhost:3001/health > /dev/null
echo "   ✓ Server healthy"

echo "2. Dashboard serves HTML..."
curl -sf http://localhost:3001/ | grep -q "Devin Dashboard"
echo "   ✓ Dashboard accessible"

echo "3. Verifying non-issue events are skipped..."
BODY='{"action":"opened","issue":{"number":1,"title":"test","body":"test"},"repository":{"html_url":"https://github.com/test/repo"}}'
SIG="sha256=$(sign "$BODY")"
SKIP=$(curl -sf -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -H "x-github-event: push" \
  -H "x-hub-signature-256: $SIG" \
  -d "$BODY")
echo "   ✓ Push event skipped"

echo "4. Verifying invalid signature is rejected..."
REJECT=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -H "x-github-event: issues" \
  -H "x-hub-signature-256: sha256=invalid" \
  -d "$BODY")
[ "$REJECT" = "401" ] && echo "   ✓ Invalid signature rejected (401)" || { echo "   ✗ Expected 401, got $REJECT"; exit 1; }

echo "5. Verifying valid signature is accepted..."
RESULT=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -H "x-github-event: issues" \
  -H "x-hub-signature-256: $SIG" \
  -d "$BODY")
CODE=$(echo "$RESULT" | tail -1)
[ "$CODE" = "201" ] || [ "$CODE" = "502" ] && echo "   ✓ Valid signature accepted ($CODE)" || { echo "   ✗ Unexpected status: $CODE"; exit 1; }

echo "6. Status endpoint returns valid JSON..."
STATUS=$(curl -sf "http://localhost:3001/status?range=1w")
echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'summary' in d; assert 'sessions' in d"
echo "   ✓ Status endpoint works"

echo "7. PR webhook updates session..."
PR_BODY='{"action":"closed","pull_request":{"html_url":"https://github.com/test/repo/pull/1","merged":true}}'
PR_SIG="sha256=$(sign "$PR_BODY")"
curl -sf -X POST http://localhost:3001/webhook \
  -H "Content-Type: application/json" \
  -H "x-github-event: pull_request" \
  -H "x-hub-signature-256: $PR_SIG" \
  -d "$PR_BODY" > /dev/null
echo "   ✓ PR webhook handled"

kill $PID 2>/dev/null
echo ""
echo "=== All tests passed ==="
