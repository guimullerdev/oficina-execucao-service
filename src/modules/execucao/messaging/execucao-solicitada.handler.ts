import { randomUUID } from 'node:crypto';

import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DYNAMODB_DOC_CLIENT,
  DYNAMODB_TABLE,
} from '../../../shared/dynamodb/dynamodb.client';
import {
  eventoKey,
  execucaoKey,
  filaKeys,
} from '../../../shared/dynamodb/keys';
import {
  TransactionWriter,
  requireTransaction,
} from '../../../shared/dynamodb/transaction';
import {
  IncomingMessage,
  MessageHandler,
} from '../../../shared/messaging/handlers/message-handler.interface';

export const EVENTO_EXECUCAO_SOLICITADA = 'os.execucao.solicitada';
export const STATUS_RECEBIDA = 'RECEBIDA';
/** Prioridade padrão das execuções recebidas (sem priorização por enquanto). */
export const PRIORIDADE_PADRAO = 0;
const PRIORIDADE_WIDTH = 3;

export type ExecucaoSolicitadaPayload = {
  id: string;
  sagaId: string;
  ordem: number;
  nome: string;
  causadoPor: string;
};

@Injectable()
export class ExecucaoSolicitadaHandler implements MessageHandler {
  readonly evento = EVENTO_EXECUCAO_SOLICITADA;
  private readonly logger = new Logger(ExecucaoSolicitadaHandler.name);

  constructor(
    @Inject(DYNAMODB_DOC_CLIENT)
    private readonly client: DynamoDBDocumentClient,
    @Inject(DYNAMODB_TABLE) private readonly tableName: string,
  ) {}

  handle(message: IncomingMessage, tx?: unknown): Promise<void> {
    // Validate synchronously: the transaction is mandatory.
    const writer = requireTransaction(tx, this.evento);
    return this.apply(message, writer);
  }

  private async apply(
    message: IncomingMessage,
    writer: TransactionWriter,
  ): Promise<void> {
    const payload = message.payload as ExecucaoSolicitadaPayload;
    const osId = payload.id;

    // Comando reenviado com outro eventId: a execução já existe, nada a gravar
    // (o processor ainda registra o eventId e confirma a transação).
    const existing = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: execucaoKey(osId),
        ConsistentRead: true,
        ProjectionExpression: 'PK',
      }),
    );
    if (existing.Item !== undefined) {
      this.logger.warn(
        `Execução já existente, comando ignorado (osId=${osId}, eventId=${message.eventId ?? message.messageId})`,
      );
      return;
    }

    const now = new Date().toISOString();
    const prioridade = PRIORIDADE_PADRAO;

    // Corrida entre réplicas: o cancelamento por este item é duplicata.
    writer.put(
      {
        Item: {
          ...execucaoKey(osId),
          ...filaKeys(
            STATUS_RECEBIDA,
            String(prioridade).padStart(PRIORIDADE_WIDTH, '0'),
            now,
          ),
          osId,
          status: STATUS_RECEBIDA,
          prioridade,
          dataAbertura: now,
          sagaId: payload.sagaId,
          ordem: payload.ordem,
          nome: payload.nome,
          causadoPor: payload.causadoPor,
          ...(message.correlationId
            ? { correlationId: message.correlationId }
            : {}),
        },
        // Um comando reenviado com outro eventId não sobrescreve a execução.
        ConditionExpression: 'attribute_not_exists(PK)',
      },
      { idempotent: true },
    );

    writer.put({
      Item: {
        ...eventoKey(osId, now, randomUUID()),
        tipo: STATUS_RECEBIDA,
        detalhe: `Execução solicitada (saga ${payload.sagaId}, ordem ${payload.ordem})`,
        criadoEm: now,
      },
    });
  }
}
