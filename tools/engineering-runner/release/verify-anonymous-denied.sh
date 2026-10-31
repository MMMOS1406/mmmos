#!/bin/sh
# MMMOS R2 post-release check (H1, prepared in 035). READ-ONLY: sends only anonymous READ requests and
# expects every one to be refused with 401 ceo_session_required. It never sends a write action.
# Usage: sh verify-anonymous-denied.sh [https://mmm-static.vercel.app]
H="${1:-https://mmm-static.vercel.app}"
fail=0
for a in engineering_task_home_list brain_v2_get_agent_runs brain_v2_overview brain_v2_get_metrics brain_v2_get_deployments \
         brain_v2_get_learning brain_v2_get_health brain_v2_get_validations brain_v2_get_knowledge brain_v2_get_decisions \
         brain_v2_get_experiments brain_v2_get_adrs brain_v2_autonomous_status brain_v2_recommend_next engineering_task_list \
         engineering_task_review_packet engineering_agent_runs_list; do
  out=$(/usr/bin/curl -s -o /dev/stdout -w ' HTTP%{http_code}' -X POST "$H/api/ops?action=$a" -H 'content-type: application/json' -d '{}')
  code=${out##* HTTP}
  if [ "$code" = "401" ]; then echo "PASS $a 401"; else echo "FAIL $a $code"; fail=1; fi
done
# Unchanged public endpoints must still answer.
for p in / /.well-known/oauth-authorization-server; do
  c=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' "$H$p"); [ "$c" = "200" ] && echo "PASS $p 200" || { echo "FAIL $p $c"; fail=1; }
done
[ $fail = 0 ] && echo "RESULT PASS" || echo "RESULT FAIL"
exit $fail
