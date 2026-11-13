output "queue_url" {
  description = "URL da fila principal do execucao-service"
  value       = aws_sqs_queue.main.url
}

output "queue_arn" {
  description = "ARN da fila principal do execucao-service"
  value       = aws_sqs_queue.main.arn
}

output "dlq_url" {
  description = "URL da DLQ do execucao-service"
  value       = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  description = "ARN da DLQ do execucao-service"
  value       = aws_sqs_queue.dlq.arn
}

output "table_name" {
  description = "Nome da tabela DynamoDB do execucao-service"
  value       = aws_dynamodb_table.execucao.name
}

output "table_arn" {
  description = "ARN da tabela DynamoDB do execucao-service"
  value       = aws_dynamodb_table.execucao.arn
}

output "os_events_subscription_arn" {
  description = "ARN da assinatura da fila no tópico oficina-os-events"
  value       = aws_sns_topic_subscription.os_events.arn
}

output "service_user_name" {
  description = "Usuário IAM do pod do execucao-service"
  value       = aws_iam_user.service.name
}
