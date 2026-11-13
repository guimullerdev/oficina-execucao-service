import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mockClient } from 'aws-sdk-client-mock';

import { OutboxPublisher } from './outbox.publisher';

const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-1' }),
);
const TABLE = 'oficina-execucao';
const TOPIC = 'arn:aws:sns:us-east-1:000000000000:oficina-execucao-events';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const pending = (over: Record<string, unknown> = {}) => ({
  PK: 'OUTBOX#ob-1',
  SK: 'OUTBOX',
  id: 'ob-1',
  evento: 'execucao.iniciada',
  aggregateType: 'Execucao',
  aggregateId: 'os-1',
  payload: { osId: 'os-1', id: 'os-1' },
  correlationId: 'corr-1',
  traceparent: '00-abc-def-01',
  OUTBOX_PK: 'PENDENTE',
  OUTBOX_SK: '2026-11-13T12:00:00.000Z',
  createdAt: '2026-11-13T12:00:00.000Z',
  ...over,
});

describe('OutboxPublisher', () => {
  let env: Record<string, string | undefined>;
  let publisher: OutboxPublisher;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    ddbMock.reset();
    snsMock.reset();
    env = { NODE_ENV: 'development', SNS_TOPIC_ARN: TOPIC };
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(UpdateCommand).resolves({});
    snsMock.on(PublishCommand).resolves({ MessageId: 'sns-1' });

    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    publisher = new OutboxPublisher(
      client,
      TABLE,
      new SNSClient({ region: 'us-east-1' }),
      config,
    );
  });

  afterEach(async () => {
    await publisher.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('publishBatch', () => {
    it('returns zeros and sends nothing for an empty batch', async () => {
      await expect(publisher.publishBatch()).resolves.toEqual({
        published: 0,
        failed: 0,
      });
      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('queries the pending GSI ordered by creation, with the default limit', async () => {
      await publisher.publishBatch();

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        TableName: TABLE,
        IndexName: 'outbox',
        KeyConditionExpression: 'OUTBOX_PK = :pendente',
        ExpressionAttributeValues: { ':pendente': 'PENDENTE' },
        ScanIndexForward: true,
        Limit: 25,
      });
    });

    it.each([
      ['10', 10],
      ['0', 25],
      ['abc', 25],
      ['2.5', 25],
    ])('OUTBOX_BATCH=%s gives Limit %i', async (raw, expected) => {
      env.OUTBOX_BATCH = raw;

      await publisher.publishBatch();

      expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(
        expected,
      );
    });

    it('publishes to SNS and then marks the item as published', async () => {
      const order: string[] = [];
      ddbMock.on(QueryCommand).resolves({ Items: [pending()] });
      snsMock.on(PublishCommand).callsFake(() => {
        order.push('publish');
        return { MessageId: 's' };
      });
      ddbMock.on(UpdateCommand).callsFake(() => {
        order.push('update');
        return {};
      });

      await expect(publisher.publishBatch()).resolves.toEqual({
        published: 1,
        failed: 0,
      });

      expect(order).toEqual(['publish', 'update']);
      expect(snsMock.commandCalls(PublishCommand)[0].args[0].input).toEqual({
        TopicArn: TOPIC,
        Message: '{"osId":"os-1","id":"os-1"}',
        MessageAttributes: {
          evento: { DataType: 'String', StringValue: 'execucao.iniciada' },
          eventId: { DataType: 'String', StringValue: 'ob-1' },
          correlationId: { DataType: 'String', StringValue: 'corr-1' },
          traceparent: { DataType: 'String', StringValue: '00-abc-def-01' },
        },
      });
      expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input).toEqual({
        TableName: TABLE,
        Key: { PK: 'OUTBOX#ob-1', SK: 'OUTBOX' },
        UpdateExpression:
          'SET publicadoEm = :agora REMOVE OUTBOX_PK, OUTBOX_SK',
        ConditionExpression: 'attribute_exists(OUTBOX_PK)',
        ExpressionAttributeValues: { ':agora': expect.stringMatching(ISO) },
      });
    });

    it.each([undefined, ''])(
      'omits empty correlationId/traceparent (%p)',
      async (empty) => {
        ddbMock.on(QueryCommand).resolves({
          Items: [pending({ correlationId: empty, traceparent: empty })],
        });

        await publisher.publishBatch();

        const attrs =
          snsMock.commandCalls(PublishCommand)[0].args[0].input
            .MessageAttributes;
        expect(Object.keys(attrs ?? {})).toEqual(['evento', 'eventId']);
      },
    );

    it('logs each published event', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [pending()] });

      await publisher.publishBatch();

      expect(log).toHaveBeenCalledWith(
        'publicado evento=execucao.iniciada eventId=ob-1 correlationId=corr-1',
      );
    });

    it('logs a dash when correlationId is empty', async () => {
      ddbMock
        .on(QueryCommand)
        .resolves({ Items: [pending({ correlationId: '' })] });

      await publisher.publishBatch();

      expect(log).toHaveBeenCalledWith(
        'publicado evento=execucao.iniciada eventId=ob-1 correlationId=-',
      );
    });

    it('leaves the item pending on publish failure and continues the batch', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [pending(), pending({ id: 'ob-2', PK: 'OUTBOX#ob-2' })],
      });
      snsMock
        .on(PublishCommand)
        .rejectsOnce(new Error('sns down'))
        .resolves({});

      await expect(publisher.publishBatch()).resolves.toEqual({
        published: 1,
        failed: 1,
      });

      const updates = ddbMock.commandCalls(UpdateCommand);
      expect(updates).toHaveLength(1);
      expect((updates[0].args[0].input.Key as { PK: string }).PK).toBe(
        'OUTBOX#ob-2',
      );
      expect(warn).toHaveBeenCalledWith(
        'Failed to publish outbox ob-1: sns down',
      );
    });

    it('handles non-Error publish rejections', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [pending()] });
      snsMock.on(PublishCommand).callsFake(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject('boom'),
      );

      await expect(publisher.publishBatch()).resolves.toEqual({
        published: 0,
        failed: 1,
      });
      expect(warn).toHaveBeenCalledWith('Failed to publish outbox ob-1: boom');
    });

    it('swallows ConditionalCheckFailed when marking as published', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [pending()] });
      ddbMock.on(UpdateCommand).rejects(
        new ConditionalCheckFailedException({
          message: 'x',
          $metadata: {},
        }),
      );

      await expect(publisher.publishBatch()).resolves.toEqual({
        published: 1,
        failed: 0,
      });
      expect(warn).toHaveBeenCalledWith(
        'Outbox ob-1 already marked as published by another replica',
      );
    });

    it('aborts the batch on other mark errors', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [pending(), pending({ id: 'ob-2', PK: 'OUTBOX#ob-2' })],
      });
      ddbMock.on(UpdateCommand).rejects(new Error('throttled'));

      await expect(publisher.publishBatch()).rejects.toThrow('throttled');
      expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    });

    it('propagates query errors', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('ddb down'));

      await expect(publisher.publishBatch()).rejects.toThrow('ddb down');
    });

    it('treats a response without Items as an empty batch', async () => {
      ddbMock.on(QueryCommand).resolves({});

      await expect(publisher.publishBatch()).resolves.toEqual({
        published: 0,
        failed: 0,
      });
    });
  });

  describe('lifecycle', () => {
    const queries = () => ddbMock.commandCalls(QueryCommand).length;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('is disabled when NODE_ENV is test', async () => {
      env.NODE_ENV = 'test';

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(queries()).toBe(0);
      expect(log).toHaveBeenCalledWith('Outbox publisher disabled');
    });

    it('is disabled by OUTBOX_PUBLISHER_ENABLED=false', async () => {
      env.OUTBOX_PUBLISHER_ENABLED = 'false';

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(queries()).toBe(0);
    });

    it('does not start without SNS_TOPIC_ARN', async () => {
      delete env.SNS_TOPIC_ARN;

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(queries()).toBe(0);
      expect(error).toHaveBeenCalledWith(
        'SNS_TOPIC_ARN is not set; outbox publisher will not start',
      );
    });

    it('polls on the interval until destroyed (flag unset means enabled)', async () => {
      env.OUTBOX_POLL_MS = '1000';

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(1000);
      expect(queries()).toBe(1);

      await jest.advanceTimersByTimeAsync(2000);
      expect(queries()).toBe(3);

      await publisher.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(5000);
      expect(queries()).toBe(3);
      expect(log).toHaveBeenCalledWith(
        'Outbox publisher started (every 1000ms)',
      );
    });

    it('falls back to the default interval for invalid OUTBOX_POLL_MS', async () => {
      env.OUTBOX_POLL_MS = '0';

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(1999);
      expect(queries()).toBe(0);

      await jest.advanceTimersByTimeAsync(1);
      expect(queries()).toBe(1);
    });

    it('survives failing batches', async () => {
      ddbMock
        .on(QueryCommand)
        .rejectsOnce(new Error('db down'))
        .rejectsOnce(new Error('again'))
        .resolves({ Items: [] });

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(6000);

      expect(queries()).toBe(3);
      expect(error).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Outbox batch failed'),
      );
    });

    it('does not run overlapping batches', async () => {
      env.OUTBOX_POLL_MS = '1000';
      let release!: (v: unknown) => void;
      ddbMock
        .on(QueryCommand)
        .callsFakeOnce(() => new Promise((r) => (release = r)))
        .resolves({ Items: [] });

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(3000);
      expect(queries()).toBe(1);

      release({ Items: [] });
      await jest.advanceTimersByTimeAsync(1000);
      expect(queries()).toBe(2);
    });

    it('waits for the in-flight batch on destroy', async () => {
      env.OUTBOX_POLL_MS = '1000';
      let release!: (v: unknown) => void;
      ddbMock
        .on(QueryCommand)
        .callsFakeOnce(() => new Promise((r) => (release = r)))
        .resolves({ Items: [] });

      publisher.onModuleInit();
      await jest.advanceTimersByTimeAsync(1000);

      let done = false;
      const destroyed = publisher.onModuleDestroy().then(() => {
        done = true;
      });
      await Promise.resolve();
      expect(done).toBe(false);

      release({ Items: [] });
      await destroyed;
      expect(done).toBe(true);
    });

    it('destroys cleanly when never started', async () => {
      await expect(publisher.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
