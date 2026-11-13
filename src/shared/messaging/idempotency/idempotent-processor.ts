import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DYNAMODB_DOC_CLIENT,
  DYNAMODB_TABLE,
} from '../../dynamodb/dynamodb.client';
import { msgKey } from '../../dynamodb/keys';
import {
  DynamoTransaction,
  TransactionWriter,
  conditionFailedAt,
} from '../../dynamodb/transaction';
import {
  IncomingMessage,
  MessageHandler,
} from '../handlers/message-handler.interface';

export type ProcessResult = 'processed' | 'duplicate';

/**
 * Garante processamento idempotente de mensagens entregues "at least once".
 *
 * A chave de idempotência (`eventId`, ou `messageId` na ausência dele) vira um
 * item MSG gravado com `attribute_not_exists(PK)` na mesma TransactWriteItems
 * dos itens do handler (e do outbox): se o handler falhar nada é gravado e o
 * erro é relançado (a mensagem não deve ser removida da fila e será
 * reentregue). Uma entrega repetida é descartada sem chamar o handler (leitura
 * consistente) ou, em corrida entre réplicas, quando a transação é cancelada
 * com `ConditionalCheckFailed` no índice do MSG.
 */
@Injectable()
export class IdempotentProcessor {
  private readonly logger = new Logger(IdempotentProcessor.name);

  constructor(
    @Inject(DYNAMODB_DOC_CLIENT)
    private readonly client: DynamoDBDocumentClient,
    @Inject(DYNAMODB_TABLE) private readonly tableName: string,
  ) {}

  /** Consumer API: a duplicate resolves, every other failure rejects. */
  async process(
    message: IncomingMessage,
    handler: MessageHandler,
  ): Promise<ProcessResult> {
    const eventId = message.eventId ?? message.messageId;

    const existing = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: msgKey(eventId),
        ConsistentRead: true,
        ProjectionExpression: 'PK',
      }),
    );
    if (existing.Item !== undefined) {
      this.warnDuplicate(eventId, message.evento);
      return 'duplicate';
    }

    const tx = new DynamoTransaction(this.client, this.tableName);
    await handler.handle(message, tx);

    // Use the returned index (not size - 1): only a ConditionalCheckFailed at
    // the MSG item means "already processed".
    const msgIndex = tx.put({
      Item: {
        ...msgKey(eventId),
        evento: message.evento,
        processadoEm: new Date().toISOString(),
        ...(message.correlationId
          ? { correlationId: message.correlationId }
          : {}),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });

    try {
      await tx.commit();
      return 'processed';
    } catch (error) {
      if (conditionFailedAt(error, msgIndex)) {
        this.warnDuplicate(eventId, message.evento);
        return 'duplicate';
      }
      throw error;
    }
  }

  /** REST path: same commit, no MSG item, all errors propagate. */
  async execute<T>(
    work: (tx: TransactionWriter) => Promise<T> | T,
  ): Promise<T> {
    const tx = new DynamoTransaction(this.client, this.tableName);
    const result = await work(tx);
    await tx.commit();
    return result;
  }

  private warnDuplicate(eventId: string, evento: string): void {
    this.logger.warn(
      `Mensagem duplicada ignorada (eventId=${eventId}, evento=${evento})`,
    );
  }
}
