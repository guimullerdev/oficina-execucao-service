#!/bin/bash
set -euo pipefail

# Idempotent: every AWS command here can be re-run without failing.
# The OS topic (oficina-os-events) is owned by the os-service flow but is created here for local dev.

REGION=us-east-1

json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

queue_arn() {
  awslocal sqs get-queue-attributes --queue-url "$1" --attribute-names QueueArn \
    --query 'Attributes.QueueArn' --output text
}

# Topics
OS_TOPIC_ARN=$(awslocal sns create-topic --name oficina-os-events --query TopicArn --output text)
EXEC_TOPIC_ARN=$(awslocal sns create-topic --name oficina-execucao-events --query TopicArn --output text)

# DLQ and execucao queue
awslocal sqs create-queue --queue-name oficina-execucao-queue-dlq >/dev/null
DLQ_URL=$(awslocal sqs get-queue-url --queue-name oficina-execucao-queue-dlq --query QueueUrl --output text)
DLQ_ARN=$(queue_arn "$DLQ_URL")

awslocal sqs create-queue --queue-name oficina-execucao-queue >/dev/null
QUEUE_URL=$(awslocal sqs get-queue-url --queue-name oficina-execucao-queue --query QueueUrl --output text)
QUEUE_ARN=$(queue_arn "$QUEUE_URL")

# Policy: only oficina-os-events can send messages to the execucao queue.
POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"AllowSnsSendMessage","Effect":"Allow","Principal":{"Service":"sns.amazonaws.com"},"Action":"sqs:SendMessage","Resource":"'"$QUEUE_ARN"'","Condition":{"ArnEquals":{"aws:SourceArn":"'"$OS_TOPIC_ARN"'"}}}]}'
REDRIVE='{"deadLetterTargetArn":"'"$DLQ_ARN"'","maxReceiveCount":"3"}'
QUEUE_ATTRS='{"RedrivePolicy":"'"$(json_escape "$REDRIVE")"'","VisibilityTimeout":"30","Policy":"'"$(json_escape "$POLICY")"'"}'
awslocal sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes "$QUEUE_ATTRS"

# Subscribe execucao queue to oficina-os-events (raw delivery + filter on MessageAttributes.evento)
SUB_ARN=$(awslocal sns subscribe --topic-arn "$OS_TOPIC_ARN" --protocol sqs \
  --notification-endpoint "$QUEUE_ARN" --query SubscriptionArn --output text)
awslocal sns set-subscription-attributes --subscription-arn "$SUB_ARN" \
  --attribute-name RawMessageDelivery --attribute-value true
awslocal sns set-subscription-attributes --subscription-arn "$SUB_ARN" \
  --attribute-name FilterPolicyScope --attribute-value MessageAttributes
awslocal sns set-subscription-attributes --subscription-arn "$SUB_ARN" \
  --attribute-name FilterPolicy \
  --attribute-value '{"evento":["os.execucao.solicitada"]}'

# Spy queue: receives everything published to oficina-execucao-events (raw, no filter), for e2e checks.
awslocal sqs create-queue --queue-name oficina-execucao-events-spy >/dev/null
SPY_URL=$(awslocal sqs get-queue-url --queue-name oficina-execucao-events-spy --query QueueUrl --output text)
SPY_ARN=$(queue_arn "$SPY_URL")
SPY_POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"AllowSnsSendMessage","Effect":"Allow","Principal":{"Service":"sns.amazonaws.com"},"Action":"sqs:SendMessage","Resource":"'"$SPY_ARN"'","Condition":{"ArnEquals":{"aws:SourceArn":"'"$EXEC_TOPIC_ARN"'"}}}]}'
awslocal sqs set-queue-attributes --queue-url "$SPY_URL" \
  --attributes '{"Policy":"'"$(json_escape "$SPY_POLICY")"'"}'
SPY_SUB_ARN=$(awslocal sns subscribe --topic-arn "$EXEC_TOPIC_ARN" --protocol sqs \
  --notification-endpoint "$SPY_ARN" --query SubscriptionArn --output text)
awslocal sns set-subscription-attributes --subscription-arn "$SPY_SUB_ARN" \
  --attribute-name RawMessageDelivery --attribute-value true

# DynamoDB single table: PK/SK, GSI fila (queue scan) and GSI outbox (outbox scan).
if ! awslocal dynamodb describe-table --table-name oficina-execucao >/dev/null 2>&1; then
  awslocal dynamodb create-table \
    --table-name oficina-execucao \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
      AttributeName=OUTBOX_PK,AttributeType=S \
      AttributeName=OUTBOX_SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
      '[{"IndexName":"fila","KeySchema":[{"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"outbox","KeySchema":[{"AttributeName":"OUTBOX_PK","KeyType":"HASH"},{"AttributeName":"OUTBOX_SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --region "$REGION" >/dev/null
  echo "created dynamodb table oficina-execucao"
else
  echo "dynamodb table oficina-execucao already exists"
fi

echo "localstack init done (region $REGION)"
