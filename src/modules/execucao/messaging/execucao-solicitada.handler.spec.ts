import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';

import { DynamoTransaction } from '../../../shared/dynamodb/transaction';
import { ExecucaoSolicitadaHandler } from './execucao-solicitada.handler';

const ddbMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-1' }),
);

describe('ExecucaoSolicitadaHandler', () => {
  const handler = new ExecucaoSolicitadaHandler(client, 'tbl');
  const message = {
    messageId: 'm1',
    eventId: 'e1',
    evento: 'os.execucao.solicitada',
    correlationId: 'corr-1',
    payload: {
      id: 'os-1',
      sagaId: 's1',
      ordem: 4,
      nome: 'EXECUTAR',
      causadoPor: 't',
    },
  };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({});
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('puts META (conditional, idempotent) and EVT in the transaction', async () => {
    const tx = new DynamoTransaction({} as never, 'tbl');
    const put = jest.spyOn(tx, 'put');

    await handler.handle(message, tx);

    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toEqual({
      TableName: 'tbl',
      Key: { PK: 'OS#os-1', SK: 'META' },
      ConsistentRead: true,
      ProjectionExpression: 'PK',
    });
    expect(put).toHaveBeenCalledTimes(2);
    const meta = put.mock.calls[0][0];
    expect(meta.Item).toMatchObject({
      PK: 'OS#os-1',
      SK: 'META',
      status: 'RECEBIDA',
      prioridade: 0,
      sagaId: 's1',
      correlationId: 'corr-1',
      GSI1PK: 'FILA',
    });
    expect(meta.Item.GSI1SK).toMatch(/^RECEBIDA#000#\d{4}-/);
    expect(meta.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(put.mock.calls[0][1]).toEqual({ idempotent: true });
    expect([...tx.idempotentIndexes]).toEqual([0]);
    const evt = put.mock.calls[1][0];
    expect(evt.Item.SK).toMatch(/^EVT#/);
    expect(evt.Item.tipo).toBe('RECEBIDA');
    expect(put.mock.calls[1][1]).toBeUndefined();
  });

  it('adds nothing when META already exists (resent command, new eventId)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { PK: 'OS#os-1' } });
    const tx = new DynamoTransaction({} as never, 'tbl');

    await expect(handler.handle(message, tx)).resolves.toBeUndefined();

    expect(tx.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      'Execução já existente, comando ignorado (osId=os-1, eventId=e1)',
    );
  });

  it('logs the messageId when eventId is absent', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { PK: 'OS#os-1' } });
    const tx = new DynamoTransaction({} as never, 'tbl');

    await handler.handle({ ...message, eventId: undefined }, tx);

    expect(warn).toHaveBeenCalledWith(
      'Execução já existente, comando ignorado (osId=os-1, eventId=m1)',
    );
  });

  it('propagates read errors', async () => {
    ddbMock.on(GetCommand).rejects(new Error('ddb down'));
    const tx = new DynamoTransaction({} as never, 'tbl');

    await expect(handler.handle(message, tx)).rejects.toThrow('ddb down');
    expect(tx.size).toBe(0);
  });

  it('omits correlationId when absent', async () => {
    const tx = new DynamoTransaction({} as never, 'tbl');
    const put = jest.spyOn(tx, 'put');
    await handler.handle({ ...message, correlationId: undefined }, tx);
    expect(put.mock.calls[0][0].Item).not.toHaveProperty('correlationId');
  });

  it('requires the processor transaction', () => {
    expect(() => handler.handle(message)).toThrow(/exige a transação/);
  });
});
