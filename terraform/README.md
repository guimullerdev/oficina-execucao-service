# Terraform — execucao-service

Cria a fila `oficina-execucao-queue` e a DLQ `oficina-execucao-queue-dlq` (redrive após 3 recebimentos),
a queue policy (somente `oficina-os-events` envia), a subscription raw delivery em `oficina-os-events`
com filtro `evento` = `os.execucao.solicitada`, a tabela DynamoDB `oficina-execucao` (PAY_PER_REQUEST,
PK/SK, GSIs `fila` e `outbox`, iguais a `scripts/localstack/init.sh`), a policy IAM e o usuário IAM
`oficina-execucao-service` (sem access key: ela é criada fora do Terraform, como no billing).

Os tópicos SNS `oficina-os-events` e `oficina-execucao-events` pertencem ao root `mensageria/` do
`oficina-infra-k8s`; aqui só são referenciados por ARN (nenhum tópico é criado).

Sem point-in-time recovery na tabela (custo mínimo; ambiente acadêmico).
A access key do pod não é gerenciada aqui (não vai para o state): ver o runbook do `oficina-infra-k8s`
(`aws iam create-access-key --user-name $(terraform output -raw service_user_name)`).

## Variáveis obrigatórias

| Variável | Descrição |
|---|---|
| `os_events_topic_arn` | ARN de `oficina-os-events` |
| `execucao_events_topic_arn` | ARN de `oficina-execucao-events` |

Opcionais (com default): `aws_region` (`us-east-1`), `queue_name`, `dlq_name`, `max_receive_count` (3),
`visibility_timeout_seconds` (30), `table_name`, `iam_user_name`.

## Apply

1. Aplicar `mensageria/` do `oficina-infra-k8s` e obter os ARNs dos dois tópicos.
2. Criar `terraform/terraform.tfvars` (não commitar):

   ```hcl
   os_events_topic_arn       = "arn:aws:sns:us-east-1:<conta>:oficina-os-events"
   execucao_events_topic_arn = "arn:aws:sns:us-east-1:<conta>:oficina-execucao-events"
   ```

3. Init, plan e apply:

   ```bash
   cd terraform
   terraform init -backend-config=backend.hcl
   terraform plan -var-file=terraform.tfvars
   terraform apply -var-file=terraform.tfvars
   ```

## Outputs

`queue_url`, `queue_arn`, `dlq_url`, `dlq_arn`, `table_name`, `table_arn`, `os_events_subscription_arn`,
`service_user_name`.

## Ciclo de vida: DynamoDB x teardown do EKS

A tabela `oficina-execucao` NÃO pertence à infra do cluster: ela sobrevive ao teardown do EKS
(`oficina-infra-k8s`) e só é destruída a partir deste repositório:

```bash
cd terraform
terraform destroy -var-file=terraform.tfvars
```

Destrua este root ANTES de remover `mensageria/` do `oficina-infra-k8s` (a assinatura depende do tópico).

## Checagem offline

```bash
terraform -chdir=terraform init -backend=false && terraform -chdir=terraform fmt -check -recursive && terraform -chdir=terraform validate
```
