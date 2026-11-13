# CLAUDE.md

## Project

oficina-execucao-service: NestJS 11 + DynamoDB (single table `oficina-execucao`).
No ORM, no relational database, no migrations.

Responsible for execution and production (Execução e Produção). It is part of a
saga orchestrated by oficina-os-service via SNS/SQS, using a transactional outbox
and idempotency by `eventId`, both stored in DynamoDB via TransactWriteItems.

## Conventions

- Routes live under the global prefix `/execucao`.
- Health: `/execucao/health`. Swagger: `/execucao/docs`.
- Messaging:
  - Consumes `os.execucao.solicitada` from SNS topic `oficina-os-events` via SQS queue `oficina-execucao-queue`.
  - Publishes `execucao.iniciada`, `execucao.concluida` and `execucao.falhou` to SNS topic `oficina-execucao-events`.
  - Message attributes: `evento`, `eventId`, `correlationId` (propagated from the command), `traceparent`.
  - Raw message delivery is enabled.
  - Idempotency and outbox records live in DynamoDB (TransactWriteItems).
- Commands:
  - `yarn lint:ci`
  - `yarn build`
  - `yarn test:cov` (coverage threshold: 80%)
- Commit messages follow Conventional Commits, in English.
- Never commit to `main`.
- Never add AI attribution (no `Co-Authored-By: Claude`, no "Generated with
  Claude Code", no mention of Claude) in commits, branches, PRs or comments.

## Git conventions

- PR granularity: ticket
- Branch: {type}/{phase}-{slug}
- PR title: {type}: {summary}
- Plan: local (the plan file lives outside the repo and is never committed)
