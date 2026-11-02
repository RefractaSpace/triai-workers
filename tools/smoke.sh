#!/usr/bin/env bash
# 로컬 점검: npx wrangler dev 가 8787에 떠 있을 때 실행 (가짜 AI 모드 .dev.vars: TRIAI_MOCK_AI=1)
set -e; B=${1:-http://127.0.0.1:8787}; J=$(mktemp)
echo "ping: $(curl -s $B/gw/ping)"
curl -s -c $J -o /dev/null -X POST $B/gw/setup -d "code=TEST-CODE-1234&username=kuro&password=password123&password2=password123" || true
curl -s -c $J -o /dev/null -X POST $B/gw/login -d "username=kuro&password=${PW:-password123}"
echo "me: $(curl -s -b $J $B/gw/me)"
curl -s -N -b $J -H "content-type: application/json" -H "X-TriAI: 1" -X POST $B/api/chat \
  -d '{"text":"점검용 질문","targets":[{"provider":"claude","model":"claude-sonnet-5-5"},{"provider":"cf","model":"@cf/openai/gpt-oss-20b"}]}' | grep -c '"done"' | sed 's/^/done events: /'
echo "convs: $(curl -s -b $J $B/api/conversations | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"
rm -f $J; echo OK
