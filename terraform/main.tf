# Recursos do execucao-service: mensageria (SQS + assinatura SNS), tabela DynamoDB e credencial IAM.
# O tópico oficina-execucao-events NÃO é criado aqui (pertence a oficina-infra-k8s/mensageria).

resource "aws_sqs_queue" "dlq" {
  name = var.dlq_name
}

resource "aws_sqs_queue" "main" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main.arn]
  })
}

# Somente o tópico oficina-os-events pode enviar mensagens para a fila.
data "aws_iam_policy_document" "queue" {
  statement {
    sid       = "AllowSnsSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.main.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [var.os_events_topic_arn]
    }
  }
}

resource "aws_sqs_queue_policy" "main" {
  queue_url = aws_sqs_queue.main.id
  policy    = data.aws_iam_policy_document.queue.json
}

# Assinatura SQS -> os-events (raw delivery + filtro por MessageAttributes.evento)
resource "aws_sns_topic_subscription" "os_events" {
  topic_arn            = var.os_events_topic_arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.main.arn
  raw_message_delivery = true
  filter_policy_scope  = "MessageAttributes"

  filter_policy = jsonencode({
    evento = ["os.execucao.solicitada"]
  })

  depends_on = [aws_sqs_queue_policy.main]
}

# Single table: PK/SK; GSI "fila" (varredura da fila de execução) e GSI "outbox" (relay do outbox).
# Sem point-in-time recovery (PITR), seguindo a escolha de custo mínimo do projeto (ambiente acadêmico).
resource "aws_dynamodb_table" "execucao" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "OUTBOX_PK"
    type = "S"
  }

  attribute {
    name = "OUTBOX_SK"
    type = "S"
  }

  global_secondary_index {
    name            = "fila"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "outbox"
    hash_key        = "OUTBOX_PK"
    range_key       = "OUTBOX_SK"
    projection_type = "ALL"
  }
}

# Policy IAM: DynamoDB (tabela + índices), publica em execucao-events e consome a fila.
data "aws_iam_policy_document" "service" {
  statement {
    sid    = "DynamoDbExecucaoTable"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:TransactWriteItems",
    ]
    resources = [
      aws_dynamodb_table.execucao.arn,
      "${aws_dynamodb_table.execucao.arn}/index/*",
    ]
  }

  statement {
    sid       = "PublishExecucaoEvents"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [var.execucao_events_topic_arn]
  }

  statement {
    sid    = "ConsumeExecucaoQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.main.arn]
  }
}

resource "aws_iam_policy" "service" {
  name        = "oficina-execucao-service"
  description = "DynamoDB oficina-execucao, publicar em oficina-execucao-events e consumir a fila do execucao-service"
  policy      = data.aws_iam_policy_document.service.json
}

# Credencial do pod (sem IRSA): chave estática de um usuário que só tem a policy acima.
resource "aws_iam_user" "service" {
  name = var.iam_user_name
}

resource "aws_iam_user_policy_attachment" "service" {
  user       = aws_iam_user.service.name
  policy_arn = aws_iam_policy.service.arn
}

# ATENÇÃO: a chave (e o secret) ficam no state, que é criptografado no bucket S3.
resource "aws_iam_access_key" "service" {
  user = aws_iam_user.service.name
}
