#!/usr/bin/env bash
# 2단계 점검 (wrangler dev 8787, 가짜 AI). smoke.sh 다음에 실행
set -e; B=${1:-http://127.0.0.1:8787}; J=$(mktemp); H=(-H content-type:application/json -H X-TriAI:1)
curl -s -c $J -o /dev/null -X POST $B/gw/login -d "username=kuro&password=${PW:-password123}"
echo "csp: $(curl -s -b $J -D - -o /dev/null $B/ | grep -ci content-security-policy)"
echo "preset: $(curl -s -b $J "${H[@]}" -X POST $B/api/presets -d '{"name":"t","temperature":0.1}' | grep -c id)"
echo "modes: $(curl -s -b $J $B/api/modes | grep -o '"id"' | wc -l)"
PID=$(curl -s -b $J "${H[@]}" -X POST $B/api/projects -d '{"name":"p","instructions":"x"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "project: $PID"
curl -s -N -b $J "${H[@]}" -X POST $B/api/chat -d "{\"project_id\":\"$PID\",\"text\":\"아티팩트 html\",\"mode\":\"code\",\"targets\":[{\"provider\":\"claude\",\"model\":\"x\"}]}" | grep -c '"end"' | sed 's/^/chat end: /'
echo "artifacts: $(curl -s -b $J $B/api/artifacts | grep -o '"id"' | wc -l)"
SID=$(curl -s -b $J "${H[@]}" -X POST $B/gw/share -d '{"doc":"<h1>hi</h1>","title":"t","lang":"html","aid":"a1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "share view: $(curl -s -o /dev/null -w '%{http_code}' $B/s/$SID) frame csp: $(curl -s -D - -o /dev/null $B/s/$SID/frame | grep -c sandbox)"
echo "admin audit: $(curl -s -b $J $B/api/admin/audit | grep -o '"action"' | wc -l) rows"
echo "websearch: $(curl -s -b $J "$B/api/websearch?q=raspberry+pi" | grep -o '"url"' | wc -l) results"
rm -f $J; echo OK2
