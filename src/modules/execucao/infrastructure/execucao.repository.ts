import { randomUUID } from 'node:crypto';

import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Inject, Injectable } from '@nestjs/common';

import {
  DYNAMODB_DOC_CLIENT,
  DYNAMODB_TABLE,
} from '../../../shared/dynamodb/dynamodb.client';
import {
  INDEX_FILA,
  eventoKey,
  execucaoKey,
  filaKeys,
} from '../../../shared/dynamodb/keys';
import { conditionFailedAt } from '../../../shared/dynamodb/transaction';
import { OutboxWriter } from '../../../shared/messaging/outbox.writer';
import { IdempotentProcessor } from '../../../shared/messaging/idempotency/idempotent-processor';
import { ConflitoDeEstadoError } from '../domain/conflito-de-estado.error';
import { Execucao } from '../domain/execucao';
import { byStatusPriorityThenOldest } from '../domain/execucao-ordering';
import { ExecucaoStatus } from '../domain/execucao-status';

const PRIORIDADE_WIDTH = 3;

export type EventoTransicao =
  'execucao.iniciada' | 'execucao.concluida' | 'execucao.falhou';

export type LinhaDoTempoItem = {
  PK: string;
  SK: string;
  tipo: string;
  detalhe?: string;
  criadoEm: string;
};

export type ExecucaoComLinhaDoTempo = {
  execucao: Execucao | null;
  linhaDoTempo: LinhaDoTempoItem[];
};

type MetaItem = {
  osId: string;
  status: ExecucaoStatus;
  prioridade: number;
  dataAbertura: string;
  sagaId: string;
  correlationId?: string;
};

function toExecucao(item: MetaItem): Execucao {
  return Execucao.fromPersistence({
    osId: item.osId,
    status: item.status,
    prioridade: item.prioridade,
    dataAbertura: new Date(item.dataAbertura),
    sagaId: item.sagaId,
    correlationId: item.correlationId ?? '',
  });
}

@Injectable()
export class ExecucaoRepository {
  constructor(
    @Inject(DYNAMODB_DOC_CLIENT)
    private readonly client: DynamoDBDocumentClient,
    @Inject(DYNAMODB_TABLE) private readonly tableName: string,
    private readonly processor: IdempotentProcessor,
    private readonly outbox: OutboxWriter,
  ) {}

  async findById(osId: string): Promise<ExecucaoComLinhaDoTempo> {
    const items = await this.queryAll({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': execucaoKey(osId).PK },
      ConsistentRead: true,
    });

    const meta = items.find((i) => i.SK === 'META') as MetaItem | undefined;
    const linhaDoTempo = items
      .filter((i) => typeof i.SK === 'string' && i.SK.startsWith('EVT#'))
      .sort((a, b) =>
        (a.SK as string).localeCompare(b.SK as string),
      ) as LinhaDoTempoItem[];

    return { execucao: meta ? toExecucao(meta) : null, linhaDoTempo };
  }

  async listFila(): Promise<Execucao[]> {
    const items = await this.queryAll({
      TableName: this.tableName,
      IndexName: INDEX_FILA,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'FILA' },
    });
    return items
      .map((i) => toExecucao(i as MetaItem))
      .sort(byStatusPriorityThenOldest);
  }

  async salvarTransicao(
    execucao: Execucao,
    statusAnterior: ExecucaoStatus,
    evento: EventoTransicao,
    detalhe?: { motivo?: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const motivo = detalhe?.motivo;
    let metaIndex = -1;

    try {
      await this.processor.execute((tx) => {
        metaIndex = tx.update({
          Key: execucaoKey(execucao.osId),
          UpdateExpression:
            'SET #status = :para, GSI1SK = :gsi1sk, atualizadoEm = :now',
          ConditionExpression: '#status = :de',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':para': execucao.status,
            ':de': statusAnterior,
            ':gsi1sk': filaKeys(
              execucao.status,
              String(execucao.prioridade).padStart(PRIORIDADE_WIDTH, '0'),
              execucao.dataAbertura.toISOString(),
            ).GSI1SK,
            ':now': now,
          },
        });

        tx.put({
          Item: {
            ...eventoKey(execucao.osId, now, randomUUID()),
            tipo: execucao.status,
            ...(motivo ? { detalhe: motivo } : {}),
            criadoEm: now,
          },
        });

        this.outbox.append(tx, [
          {
            evento,
            aggregateType: 'Execucao',
            aggregateId: execucao.osId,
            payload: { sagaId: execucao.sagaId, ...(motivo ? { motivo } : {}) },
            correlationId: execucao.correlationId,
          },
        ]);
      });
    } catch (error) {
      if (metaIndex >= 0 && conditionFailedAt(error, metaIndex)) {
        throw new ConflitoDeEstadoError(execucao.osId);
      }
      throw error;
    }
  }

  private async queryAll(
    input: QueryCommandInput,
  ): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({ ...input, ExclusiveStartKey: startKey }),
      );
      result.push(...(page.Items ?? []));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return result;
  }
}
