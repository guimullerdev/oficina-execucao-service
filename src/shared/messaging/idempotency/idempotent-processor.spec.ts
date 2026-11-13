import {
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';

import {
  DynamoTransaction,
  conditionFailedAt,
  requireTransaction,
} from '../../dynamodb/transaction';
import type {
  IncomingMessage,
  MessageHandler,
} from '../handlers/message-handler.interface';
import { OutboxWriter } from '../outbox.writer';
import { IdempotentProcessor } from './idempotent-processor';

const ddbMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-1' }),
);
const TABLE = 'oficina-execucao';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const canceled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

const message: IncomingMessage = {
  messageId: 'msg-1',
  eventId: 'evt-1',
  evento: 'os.execucao.solicitada',
  payload: { id: 'os-1' },
  correlationId: 'corr-1',
};

const transactItems = (index = 0) =>
  ddbMock.commandCalls(TransactWriteCommand)[index].args[0].input
    .TransactItems!;

describe('IdempotentProcessor', () => {
  let processor: IdempotentProcessor;
  let handle: jest.Mock;
  let handler: MessageHandler;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(TransactWriteCommand).resolves({});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    processor = new IdempotentProcessor(client, TABLE);
    handle = jest.fn((_m: IncomingMessage, tx?: unknown) => {
      requireTransaction(tx, 'os.execucao.solicitada').put({
        Item: { PK: 'OS#os-1', SK: 'META', status: 'RECEBIDA' },
      });
      return Promise.resolve();
    });
    handler = { evento: 'os.execucao.solicitada', handle };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('process', () => {
    it('processes and commits handler items + MSG atomically', async () => {
      await expect(processor.process(message, handler)).resolves.toBe(
        'processed',
      );

      const gets = ddbMock.commandCalls(GetCommand);
      expect(gets).toHaveLength(1);
      expect(gets[0].args[0].input).toEqual({
        TableName: TABLE,
        Key: { PK: 'MSG#evt-1', SK: 'MSG' },
        ConsistentRead: true,
        ProjectionExpression: 'PK',
      });
      expect(handle).toHaveBeenCalledWith(
        message,
        expect.any(DynamoTransaction),
      );
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
      const items = transactItems();
      expect(items).toHaveLength(2);
      expect(items[0].Put!.Item).toEqual({
        PK: 'OS#os-1',
        SK: 'META',
        status: 'RECEBIDA',
      });
      expect(items[1]).toEqual({
        Put: {
          TableName: TABLE,
          Item: {
            PK: 'MSG#evt-1',
            SK: 'MSG',
            evento: 'os.execucao.solicitada',
            processadoEm: expect.stringMatching(ISO),
            correlationId: 'corr-1',
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    });

    it('falls back to messageId when eventId is absent', async () => {
      await processor.process({ ...message, eventId: undefined }, handler);

      expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({
        PK: 'MSG#msg-1',
        SK: 'MSG',
      });
      expect(transactItems()[1].Put!.Item!.PK).toBe('MSG#msg-1');
    });

    it('omits correlationId on MSG when absent', async () => {
      await processor.process(
        { ...message, correlationId: undefined },
        handler,
      );

      expect('correlationId' in transactItems()[1].Put!.Item!).toBe(false);
    });

    it('writes outbox items carrying the incoming correlationId in the same transaction', async () => {
      const outbox = new OutboxWriter();
      const withOutbox: MessageHandler = {
        evento: 'os.execucao.solicitada',
        handle: (_m, tx) => {
          outbox.append(requireTransaction(tx, 'os.execucao.solicitada'), [
            {
              evento: 'execucao.iniciada',
              aggregateType: 'Execucao',
              aggregateId: 'os-1',
              payload: {},
              correlationId: message.correlationId!,
            },
          ]);
          return Promise.resolve();
        },
      };

      await processor.process(message, withOutbox);

      const items = transactItems();
      expect(items).toHaveLength(2);
      const outboxItem = items[0].Put!.Item!;
      expect(outboxItem.PK).toMatch(/^OUTBOX#/);
      expect(outboxItem.correlationId).toBe('corr-1');
      expect(outboxItem.payload).toEqual({ osId: 'os-1', id: 'os-1' });
      expect(items[1].Put!.Item!.PK).toBe('MSG#evt-1');
    });

    it('fast-path duplicate skips the handler', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { PK: 'MSG#evt-1' } });

      await expect(processor.process(message, handler)).resolves.toBe(
        'duplicate',
      );

      expect(handle).not.toHaveBeenCalled();
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        'Mensagem duplicada ignorada (eventId=evt-1, evento=os.execucao.solicitada)',
      );
    });

    it('treats ConditionalCheckFailed at the MSG index as a duplicate (race)', async () => {
      ddbMock
        .on(TransactWriteCommand)
        .rejects(canceled('None', 'ConditionalCheckFailed'));

      await expect(processor.process(message, handler)).resolves.toBe(
        'duplicate',
      );

      expect(warn).toHaveBeenCalledWith(
        'Mensagem duplicada ignorada (eventId=evt-1, evento=os.execucao.solicitada)',
      );
    });

    it('is a duplicate even when handler items also failed', async () => {
      ddbMock
        .on(TransactWriteCommand)
        .rejects(canceled('ConditionalCheckFailed', 'ConditionalCheckFailed'));

      await expect(processor.process(message, handler)).resolves.toBe(
        'duplicate',
      );
    });

    it('rethrows ConditionalCheckFailed on a handler item only', async () => {
      const err = canceled('ConditionalCheckFailed', 'None');
      ddbMock.on(TransactWriteCommand).rejects(err);

      await expect(processor.process(message, handler)).rejects.toBe(err);
      expect(warn).not.toHaveBeenCalled();
    });

    it('rethrows TransactionConflict at the MSG index', async () => {
      const err = canceled('None', 'TransactionConflict');
      ddbMock.on(TransactWriteCommand).rejects(err);

      await expect(processor.process(message, handler)).rejects.toBe(err);
    });

    it('rethrows generic commit errors', async () => {
      ddbMock.on(TransactWriteCommand).rejects(new Error('throttled'));

      await expect(processor.process(message, handler)).rejects.toThrow(
        'throttled',
      );
    });

    it('handler error aborts without writing', async () => {
      handle.mockRejectedValueOnce(new Error('payload inválido'));

      await expect(processor.process(message, handler)).rejects.toThrow(
        'payload inválido',
      );
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('handler with no items still records MSG at index 0', async () => {
      handle = jest.fn().mockResolvedValue(undefined);
      handler = { evento: 'os.execucao.solicitada', handle };

      await expect(processor.process(message, handler)).resolves.toBe(
        'processed',
      );
      expect(transactItems()).toHaveLength(1);

      ddbMock
        .on(TransactWriteCommand)
        .rejects(canceled('ConditionalCheckFailed'));
      await expect(processor.process(message, handler)).resolves.toBe(
        'duplicate',
      );
    });

    it('fast-path read errors propagate', async () => {
      ddbMock.on(GetCommand).rejects(new Error('ddb down'));

      await expect(processor.process(message, handler)).rejects.toThrow(
        'ddb down',
      );
      expect(handle).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('commits work items without MSG and returns the result', async () => {
      const result = await processor.execute((tx) => {
        tx.put({ Item: { PK: 'OS#os-1', SK: 'EVT#t#1' } });
        return Promise.resolve(42);
      });

      expect(result).toBe(42);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
      const items = transactItems();
      expect(items).toHaveLength(1);
      expect(
        items.some((i) => String(i.Put?.Item?.PK).startsWith('MSG#')),
      ).toBe(false);
    });

    it('accepts sync work', async () => {
      await expect(
        processor.execute((tx) => {
          tx.put({ Item: { PK: 'OS#os-1', SK: 'EVT#t#1' } });
          return 'ok';
        }),
      ).resolves.toBe('ok');
    });

    it('empty work sends nothing', async () => {
      await expect(processor.execute(() => 'nada')).resolves.toBe('nada');
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('propagates TransactionCanceledException for 409 mapping', async () => {
      const err = canceled('ConditionalCheckFailed');
      ddbMock.on(TransactWriteCommand).rejects(err);

      const caught: unknown = await processor
        .execute((tx) => {
          tx.update({
            Key: { PK: 'OS#os-1', SK: 'META' },
            UpdateExpression: 'SET x = :x',
            ExpressionAttributeValues: { ':x': 1 },
          });
        })
        .catch((e: unknown) => e);

      expect(caught).toBe(err);
      expect(conditionFailedAt(caught, 0)).toBe(true);
    });

    it('work error aborts', async () => {
      await expect(
        processor.execute(() => {
          throw new Error('transição inválida');
        }),
      ).rejects.toThrow('transição inválida');
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });
  });
});
