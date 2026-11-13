variable "aws_region" {
  description = "Região AWS — precisa ser a mesma do SNS/SQS e do restante da infra da oficina"
  type        = string
  default     = "us-east-1"
}

variable "os_events_topic_arn" {
  description = "ARN do tópico SNS oficina-os-events (assinado pela fila do execucao-service)"
  type        = string

  validation {
    condition     = can(regex("^arn:aws:sns:", var.os_events_topic_arn))
    error_message = "os_events_topic_arn deve ser um ARN SNS (começa com arn:aws:sns:)."
  }
}

variable "execucao_events_topic_arn" {
  description = "ARN do tópico SNS oficina-execucao-events (publicado pelo execucao-service; criado em oficina-infra-k8s/mensageria)"
  type        = string

  validation {
    condition     = can(regex("^arn:aws:sns:", var.execucao_events_topic_arn))
    error_message = "execucao_events_topic_arn deve ser um ARN SNS (começa com arn:aws:sns:)."
  }
}

variable "queue_name" {
  description = "Nome da fila SQS principal do execucao-service"
  type        = string
  default     = "oficina-execucao-queue"
}

variable "dlq_name" {
  description = "Nome da dead-letter queue do execucao-service"
  type        = string
  default     = "oficina-execucao-queue-dlq"
}

variable "max_receive_count" {
  description = "Número de recebimentos antes de a mensagem ir para a DLQ (redrive policy)"
  type        = number
  default     = 3
}

variable "visibility_timeout_seconds" {
  description = "Visibility timeout da fila principal, em segundos"
  type        = number
  default     = 30
}

variable "table_name" {
  description = "Nome da tabela DynamoDB single-table do execucao-service"
  type        = string
  default     = "oficina-execucao"
}

variable "iam_user_name" {
  description = "Nome do usuário IAM usado pelo pod do execucao-service"
  type        = string
  default     = "oficina-execucao-service"
}
