#!/usr/bin/env bash
# End-to-end smoke test of the execucao flow against a running app and LocalStack.
#
# Flow: SNS publish os.execucao.solicitada -> RECEBIDA -> finalizar (409) ->
# iniciar (204) -> finalizar (204) -> spy queue events -> FINALIZADA + timeline -> DLQ empty.
#
# Requires: docker (container oficina_execucao_localstack running), curl, jq, node
# (jsonwebtoken or @nestjs/jwt in the repo node_modules), JWT_SECRET matching the app.
#
# Usage: BASE_URL=http://localhost:3000 JWT_SECRET=... scripts/localstack/smoke-execucao.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
JWT_SECRET="${JWT_SECRET:?JWT_SECRET is required}"
CONTAINER="${LOCALSTACK_CONTAINER:-oficina_execucao_localstack}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

OS_TOPIC_ARN="arn:aws:sns:us-east-1:000000000000:oficina-os-events"
SPY_QUEUE="oficina-execucao-events-spy"
DLQ_QUEUE="oficina-execucao-queue-dlq"

OS="os-smoke-$(date +%s)"
EVT="evt-smoke-$(date +%s)-$RANDOM"
CORR="corr-smoke-$(date +%s)-$RANDOM"

FAILURES=0

aws() { docker exec "$CONTAINER" awslocal "$@"; }

record() {
  local name="$1"
  shift
  if "$@"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_eq() { # name actual expected
  local name="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name (got '$actual', expected '$expected')"
    FAILURES=$((FAILURES + 1))
  fi
}

http_patch_status() { # $1 = action (iniciar|finalizar)
  curl -s -o /dev/null -w '%{http_code}' -X PATCH \
    -H "Authorization: Bearer $TOKEN" "$BASE_URL/execucao/$OS/$1"
}

get_execucao() {
  curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/execucao/$OS"
}

# Non-destructive read: visibility timeout 0 keeps messages available for later polls.
spy_find() { # $1 = evento; prints a JSON summary for the matching message, if any
  aws sqs receive-message --queue-url "$SPY_URL" --max-number-of-messages 10 \
    --message-attribute-names All --visibility-timeout 0 --wait-time-seconds 0 \
    | jq -c --arg os "$OS" --arg ev "$1" '
        .Messages[]?
        | select(.MessageAttributes.evento.StringValue == $ev)
        | (.Body | fromjson? // {}) as $p
        | select($p.osId == $os)
        | {
            evento: $ev,
            osId: $p.osId,
            eventId: (.MessageAttributes.eventId.StringValue // ""),
            correlationId: (.MessageAttributes.correlationId.StringValue // "")
          }' \
    | head -n 1 || true
}

echo "== smoke-execucao: osId=$OS correlationId=$CORR base=$BASE_URL"

# 1-2. Publish os.execucao.solicitada
MSG=$(jq -cn --arg id "$OS" \
  '{id: $id, sagaId: "s-smoke", ordem: 4, nome: "EXECUTAR", causadoPor: "smoke"}')
aws sns publish --topic-arn "$OS_TOPIC_ARN" --message "$MSG" \
  --message-attributes "evento={DataType=String,StringValue=os.execucao.solicitada},eventId={DataType=String,StringValue=$EVT},correlationId={DataType=String,StringValue=$CORR}" \
  >/dev/null
echo "published os.execucao.solicitada to oficina-os-events"

# 3. Staff JWT (claims as checked by JwtAuthGuard: verified with JWT_SECRET; RolesGuard reads role)
TOKEN=$(cd "$REPO_DIR" && JWT_SECRET="$JWT_SECRET" node -e '
const secret = process.env.JWT_SECRET;
const payload = { sub: "smoke-admin", role: "ADMIN" };
let sign;
try {
  const jwt = require("jsonwebtoken");
  sign = () => jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "15m" });
} catch (_) {
  const { JwtService } = require("@nestjs/jwt");
  const svc = new JwtService({ secret });
  sign = () => svc.sign(payload, { expiresIn: "15m" });
}
process.stdout.write(sign());
')

STATUS=""
for _ in $(seq 1 30); do
  STATUS=$(get_execucao | jq -r '.execucao.status // empty' 2>/dev/null || true)
  if [[ "$STATUS" == "RECEBIDA" ]]; then break; fi
  sleep 0.5
done
assert_eq "GET status RECEBIDA after solicitada (max ~15s)" "$STATUS" "RECEBIDA"

# 4. finalizar before iniciar must conflict
CODE=$(http_patch_status finalizar)
assert_eq "PATCH finalizar before iniciar -> 409" "$CODE" "409"

# 5. iniciar then finalizar
CODE=$(http_patch_status iniciar)
assert_eq "PATCH iniciar -> 204" "$CODE" "204"
CODE=$(http_patch_status finalizar)
assert_eq "PATCH finalizar -> 204" "$CODE" "204"

# 6. Spy queue: execucao.iniciada and execucao.concluida for this OS
SPY_URL=$(aws sqs get-queue-url --queue-name "$SPY_QUEUE" --query QueueUrl --output text)
INI=""
CON=""
for _ in $(seq 1 20); do
  if [[ -z "$INI" ]]; then INI=$(spy_find execucao.iniciada); fi
  if [[ -z "$CON" ]]; then CON=$(spy_find execucao.concluida); fi
  if [[ -n "$INI" && -n "$CON" ]]; then break; fi
  sleep 1
done

if [[ -n "$INI" ]]; then
  echo "PASS  spy execucao.iniciada seen for osId"
  assert_eq "iniciada correlationId=CORR" "$(jq -r .correlationId <<<"$INI")" "$CORR"
  record "iniciada has eventId attribute" test -n "$(jq -r .eventId <<<"$INI")"
else
  echo "FAIL  spy execucao.iniciada seen for osId"
  FAILURES=$((FAILURES + 1))
fi

if [[ -n "$CON" ]]; then
  echo "PASS  spy execucao.concluida seen for osId"
  assert_eq "concluida correlationId=CORR" "$(jq -r .correlationId <<<"$CON")" "$CORR"
  record "concluida has eventId attribute" test -n "$(jq -r .eventId <<<"$CON")"
else
  echo "FAIL  spy execucao.concluida seen for osId"
  FAILURES=$((FAILURES + 1))
fi

# 7. Final state and timeline
DETAIL=$(get_execucao || true)
assert_eq "GET status FINALIZADA" "$(jq -r '.execucao.status // empty' <<<"$DETAIL" 2>/dev/null || true)" "FINALIZADA"
TL=$(jq -r '.linhaDoTempo | length' <<<"$DETAIL" 2>/dev/null || echo 0)
record "timeline has >=3 entries (got $TL)" test "$TL" -ge 3

# 8. DLQ empty
DLQ_URL=$(aws sqs get-queue-url --queue-name "$DLQ_QUEUE" --query QueueUrl --output text)
DLQ_N=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages' --output text)
assert_eq "DLQ ApproximateNumberOfMessages = 0" "$DLQ_N" "0"

if (( FAILURES > 0 )); then
  echo "RESULT: FAIL ($FAILURES check(s) failed)"
  exit 1
fi
echo "RESULT: PASS (all checks)"
