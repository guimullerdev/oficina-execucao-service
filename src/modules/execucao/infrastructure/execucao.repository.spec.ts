import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

import { IdempotentProcessor } from '../../../shared/messaging/idempotency/idempotent-processor';
import { OutboxWriter } from '../../../shared/messaging/outbox.writer';
import { ConflitoDeEstadoError } from '../domain/conflito-de-estado.error';
import { Execucao } from '../domain/execucao';
import { ExecucaoStatus } from '../domain/execucao-status';
import { ExecucaoRepository } from './execucao.repository';

const dc = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-1' }),
);
const ddb = mockClient(dc);

function meta(osId: string, status: string, dataAbertura: string) {
  return {
    PK: `OS#${osId}`,
    SK: 'META',
    osId,
    status,
    prioridade: 0,
    dataAbertura,
    sagaId: 'saga-1',
    correlationId: 'corr-1',
  };
}

describe('ExecucaoRepository', () => {
  let repo: ExecucaoRepository;

  beforeEach(() => {
    ddb.reset();
    repo = new ExecucaoRepository(
      dc,
      'tbl',
      new IdempotentProcessor(dc, 'tbl'),
      new OutboxWriter(),
    );
  });

  describe('findById', () => {
    it('retorna META e linha do tempo ordenada', async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          { PK: 'OS#1', SK: 'EVT#2024-01-02#b', tipo: 'EM_EXECUCAO' },
          meta('1', 'EM_EXECUCAO', '2024-01-01T00:00:00.000Z'),
          { PK: 'OS#1', SK: 'EVT#2024-01-01#a', tipo: 'RECEBIDA' },
        ],
      });
      const r = await repo.findById('1');
      expect(r.execucao?.osId).toBe('1');
      expect(r.execucao?.status).toBe(ExecucaoStatus.EM_EXECUCAO);
      expect(r.execucao?.dataAbertura).toEqual(
        new Date('2024-01-01T00:00:00.000Z'),
      );
      expect(r.linhaDoTempo.map((e) => e.tipo)).toEqual([
        'RECEBIDA',
        'EM_EXECUCAO',
      ]);
    });

    it('retorna null quando não existe', async () => {
      ddb.on(QueryCommand).resolves({});
      expect(await repo.findById('x')).toEqual({
        execucao: null,
        linhaDoTempo: [],
      });
    });

    it('usa correlationId vazio quando ausente no META', async () => {
      const m = meta('1', 'RECEBIDA', '2024-01-01T00:00:00.000Z') as Record<
        string,
        unknown
      >;
      delete m.correlationId;
      ddb.on(QueryCommand).resolves({ Items: [m] });
      expect((await repo.findById('1')).execucao?.correlationId).toBe('');
    });
  });

  describe('listFila', () => {
    it('pagina e ordena por status e antiguidade', async () => {
      ddb
        .on(QueryCommand)
        .resolvesOnce({
          Items: [
            meta('a', 'RECEBIDA', '2024-01-01T00:00:00.000Z'),
            meta('b', 'FINALIZADA', '2023-01-01T00:00:00.000Z'),
          ],
          LastEvaluatedKey: { PK: 'k' },
        })
        .resolvesOnce({
          Items: [
            meta('c', 'EM_EXECUCAO', '2024-02-01T00:00:00.000Z'),
            meta('d', 'RECEBIDA', '2023-06-01T00:00:00.000Z'),
          ],
        });
      const r = await repo.listFila();
      expect(r.map((e) => e.osId)).toEqual(['c', 'd', 'a', 'b']);
      const calls = ddb.commandCalls(QueryCommand);
      expect(calls).toHaveLength(2);
      expect(calls[0].args[0].input).toMatchObject({
        IndexName: 'fila',
        ExpressionAttributeValues: { ':pk': 'FILA' },
      });
      expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({ PK: 'k' });
    });
  });

  describe('salvarTransicao', () => {
    const build = () =>
      Execucao.fromPersistence({
        osId: '1',
        status: ExecucaoStatus.RECEBIDA,
        prioridade: 5,
        dataAbertura: new Date('2024-01-01T00:00:00.000Z'),
        sagaId: 'saga-1',
        correlationId: 'corr-1',
      });

    it('envia 3 itens: update condicional, evento e outbox', async () => {
      ddb.on(TransactWriteCommand).resolves({});
      const e = build();
      const anterior = e.iniciar();
      await repo.salvarTransicao(e, anterior, 'execucao.iniciada');

      const items =
        ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
      expect(items).toHaveLength(3);
      expect(items[0].Update).toMatchObject({
        Key: { PK: 'OS#1', SK: 'META' },
        ConditionExpression: '#status = :de',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: expect.objectContaining({
          ':de': 'RECEBIDA',
          ':para': 'EM_EXECUCAO',
          ':gsi1sk': 'EM_EXECUCAO#005#2024-01-01T00:00:00.000Z',
        }) as unknown,
      });
      expect(items[1].Put?.Item).toMatchObject({
        PK: 'OS#1',
        tipo: 'EM_EXECUCAO',
      });
      expect(items[1].Put?.Item?.SK).toMatch(/^EVT#/);
      expect(items[1].Put?.Item).not.toHaveProperty('detalhe');
      expect(items[2].Put?.Item).toMatchObject({
        evento: 'execucao.iniciada',
        aggregateId: '1',
        correlationId: 'corr-1',
        payload: { sagaId: 'saga-1', osId: '1', id: '1' },
      });
      expect(items[2].Put?.Item?.payload).not.toHaveProperty('motivo');
    });

    it('inclui motivo no evento falhou', async () => {
      ddb.on(TransactWriteCommand).resolves({});
      const e = build();
      const anterior = e.falhar('sem peça');
      await repo.salvarTransicao(e, anterior, 'execucao.falhou', {
        motivo: 'sem peça',
      });
      const items =
        ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
      expect(items[1].Put?.Item).toMatchObject({ detalhe: 'sem peça' });
      expect(items[2].Put?.Item?.payload).toEqual({
        sagaId: 'saga-1',
        motivo: 'sem peça',
        osId: '1',
        id: '1',
      });
    });

    it('lança ConflitoDeEstadoError em CCF no META', async () => {
      const err = Object.assign(new Error('cancelled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [
          { Code: 'ConditionalCheckFailed' },
          { Code: 'None' },
          { Code: 'None' },
        ],
      });
      ddb.on(TransactWriteCommand).rejects(err);
      const e = build();
      const anterior = e.iniciar();
      await expect(
        repo.salvarTransicao(e, anterior, 'execucao.iniciada'),
      ).rejects.toBeInstanceOf(ConflitoDeEstadoError);
    });

    it('relança outros erros', async () => {
      const err = new Error('boom');
      ddb.on(TransactWriteCommand).rejects(err);
      const e = build();
      const anterior = e.iniciar();
      await expect(
        repo.salvarTransicao(e, anterior, 'execucao.iniciada'),
      ).rejects.toBe(err);
    });
  });
});
