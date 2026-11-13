import {
  MessageAttributeValue,
  PublishCommand,
  SNSClient,
} from '@aws-sdk/client-sns';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DYNAMODB_DOC_CLIENT,
  DYNAMODB_TABLE,
} from '../dynamodb/dynamodb.client';
import { INDEX_OUTBOX, OUTBOX_PENDENTE, outboxKey } from '../dynamodb/keys';
import { isConditionalCheckFailed } from '../dynamodb/transaction';
import type { OutboxItem } from './outbox.writer';

export type PendingOutbox = Pick<
  OutboxItem,
  'id' | 'evento' | 'payload' | 'correlationId' | 'traceparent'
>;

export interface PublishBatchResult {
  published: number;
  failed: number;
}

const DEFAULT_POLL_MS = 2000;
const DEFAULT_BATCH = 25;

const positiveInt = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const stringAttr = (value: string): MessageAttributeValue => ({
  DataType: 'String',
  StringValue: value,
});

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Publica periodicamente os itens OUTBOX pendentes (GSI esparso `outbox`) no
 * tópico SNS.
 *
 * Semântica at-least-once: o item só sai do índice (REMOVE OUTBOX_PK/SK) depois
 * que o SNS confirmou o publish. Duplicatas (duas réplicas, leitura obsoleta do
 * GSI ou falha ao marcar) são absorvidas pela deduplicação do consumidor pelo
 * atributo `eventId` (id do item OUTBOX).
 */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(
    @Inject(DYNAMODB_DOC_CLIENT)
    private readonly client: DynamoDBDocumentClient,
    @Inject(DYNAMODB_TABLE) private readonly tableName: string,
    private readonly sns: SNSClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (
      this.config.get<string>('NODE_ENV') === 'test' ||
      this.config.get<string>('OUTBOX_PUBLISHER_ENABLED') === 'false'
    ) {
      this.logger.log('Outbox publisher disabled');
      return;
    }
    if (!this.topicArn) {
      this.logger.error(
        'SNS_TOPIC_ARN is not set; outbox publisher will not start',
      );
      return;
    }

    const interval = positiveInt(
      this.config.get('OUTBOX_POLL_MS'),
      DEFAULT_POLL_MS,
    );
    this.timer = setInterval(() => this.tick(), interval);
    this.timer.unref();
    this.logger.log(`Outbox publisher started (every ${interval}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Um lote em andamento termina antes do shutdown.
    await this.inFlight;
  }

  private get topicArn(): string {
    return this.config.get<string>('SNS_TOPIC_ARN') ?? '';
  }

  private tick(): void {
    if (this.inFlight) {
      return;
    }
    this.inFlight = this.publishBatch()
      .then(
        () => undefined,
        (err: unknown) => {
          this.logger.error(`Outbox batch failed: ${errorMessage(err)}`);
        },
      )
      .finally(() => {
        this.inFlight = undefined;
      });
  }

  /** Publica um lote de itens pendentes. Público para testes. */
  async publishBatch(): Promise<PublishBatchResult> {
    const limit = positiveInt(this.config.get('OUTBOX_BATCH'), DEFAULT_BATCH);

    const { Items } = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: INDEX_OUTBOX,
        KeyConditionExpression: 'OUTBOX_PK = :pendente',
        ExpressionAttributeValues: { ':pendente': OUTBOX_PENDENTE },
        ScanIndexForward: true,
        Limit: limit,
      }),
    );

    const result: PublishBatchResult = { published: 0, failed: 0 };
    for (const item of (Items ?? []) as PendingOutbox[]) {
      if (await this.publishOne(item)) {
        result.published++;
      } else {
        result.failed++;
      }
    }
    return result;
  }

  private async publishOne(item: PendingOutbox): Promise<boolean> {
    try {
      await this.sns.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(item.payload),
          MessageAttributes: this.attributesFor(item),
        }),
      );
    } catch (err) {
      // O item continua pendente e o lote segue.
      this.logger.warn(
        `Failed to publish outbox ${item.id}: ${errorMessage(err)}`,
      );
      return false;
    }

    await this.markPublished(item);
    this.logger.log(
      `publicado evento=${item.evento} eventId=${item.id} correlationId=${item.correlationId || '-'}`,
    );
    return true;
  }

  private async markPublished(item: PendingOutbox): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: outboxKey(item.id),
          UpdateExpression:
            'SET publicadoEm = :agora REMOVE OUTBOX_PK, OUTBOX_SK',
          ConditionExpression: 'attribute_exists(OUTBOX_PK)',
          ExpressionAttributeValues: { ':agora': new Date().toISOString() },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        this.logger.warn(
          `Outbox ${item.id} already marked as published by another replica`,
        );
        return;
      }
      // Se o DynamoDB está falhando, publicar mais itens só geraria mais
      // duplicatas: aborta o lote; o item é republicado no próximo tick.
      throw err;
    }
  }

  private attributesFor(
    item: PendingOutbox,
  ): Record<string, MessageAttributeValue> {
    const attributes: Record<string, MessageAttributeValue> = {
      evento: stringAttr(item.evento),
      eventId: stringAttr(item.id),
    };
    if (item.correlationId) {
      attributes.correlationId = stringAttr(item.correlationId);
    }
    if (item.traceparent) {
      attributes.traceparent = stringAttr(item.traceparent);
    }
    return attributes;
  }
}
