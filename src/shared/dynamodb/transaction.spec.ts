import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

import {
  DynamoTransaction,
  cancellationReasons,
  conditionFailedAt,
  isConditionalCheckFailed,
  requireTransaction,
} from './transaction';

const ddbMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'us-east-1' }),
);
const TABLE = 'oficina-execucao';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const canceled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

describe('DynamoTransaction', () => {
  let tx: DynamoTransaction;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(TransactWriteCommand).resolves({});
    tx = new DynamoTransaction(client, TABLE);
  });

  it('returns sequential indexes and size', () => {
    const first = tx.put({ Item: { PK: 'A', SK: '1' } });
    const second = tx.update({
      Key: { PK: 'A', SK: '2' },
      UpdateExpression: 'SET x = :x',
      ExpressionAttributeValues: { ':x': 1 },
    });

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(tx.size).toBe(2);
  });

  it('commits one TransactWriteCommand in insertion order with TableName injected', async () => {
    tx.put({
      Item: { PK: 'A', SK: '1' },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
    tx.update({
      Key: { PK: 'A', SK: '2' },
      UpdateExpression: 'SET x = :x',
      ExpressionAttributeValues: { ':x': 1 },
    });

    await tx.commit();

    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TransactItems).toEqual([
      {
        Put: {
          TableName: TABLE,
          Item: { PK: 'A', SK: '1' },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Update: {
          TableName: TABLE,
          Key: { PK: 'A', SK: '2' },
          UpdateExpression: 'SET x = :x',
          ExpressionAttributeValues: { ':x': 1 },
        },
      },
    ]);
    expect(input.ClientRequestToken).toMatch(UUID);
  });

  it('uses a fresh ClientRequestToken per transaction', async () => {
    const other = new DynamoTransaction(client, TABLE);
    tx.put({ Item: { PK: 'A', SK: '1' } });
    other.put({ Item: { PK: 'A', SK: '1' } });

    await tx.commit();
    await other.commit();

    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.ClientRequestToken).not.toBe(
      calls[1].args[0].input.ClientRequestToken,
    );
  });

  it('empty commit sends nothing', async () => {
    await tx.commit();

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('commit twice throws', async () => {
    tx.put({ Item: { PK: 'A', SK: '1' } });
    await tx.commit();

    await expect(tx.commit()).rejects.toThrow(
      'Transação DynamoDB já confirmada',
    );
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });

  it('put/update after commit throws', async () => {
    await tx.commit();

    expect(() => tx.put({ Item: { PK: 'A', SK: '1' } })).toThrow(
      'já confirmada',
    );
    expect(() =>
      tx.update({
        Key: { PK: 'A', SK: '2' },
        UpdateExpression: 'SET x = :x',
        ExpressionAttributeValues: { ':x': 1 },
      }),
    ).toThrow('já confirmada');
  });

  it('rejects duplicate keys', () => {
    tx.put({ Item: { PK: 'A', SK: '1' } });

    expect(() =>
      tx.update({
        Key: { PK: 'A', SK: '1' },
        UpdateExpression: 'SET y = :y',
        ExpressionAttributeValues: { ':y': 2 },
      }),
    ).toThrow('Item duplicado na transação: A|1');
    expect(tx.size).toBe(1);
  });

  it('enforces 100-item limit', () => {
    for (let i = 0; i < 100; i++) {
      tx.put({ Item: { PK: 'A', SK: String(i) } });
    }

    expect(tx.size).toBe(100);
    expect(() => tx.put({ Item: { PK: 'A', SK: '100' } })).toThrow(
      'excede 100 itens',
    );
  });

  it('propagates SDK errors and stays closed', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled('None'));
    tx.put({ Item: { PK: 'A', SK: '1' } });

    await expect(tx.commit()).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
    expect(() => tx.put({ Item: { PK: 'A', SK: '2' } })).toThrow(
      'já confirmada',
    );
  });
});

describe('cancellationReasons', () => {
  it('returns the reasons of a TransactionCanceledException', () => {
    expect(
      cancellationReasons(canceled('None', 'ConditionalCheckFailed')),
    ).toEqual([{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]);
  });

  it('returns an empty list when the exception has no reasons', () => {
    expect(
      cancellationReasons(
        new TransactionCanceledException({ message: 'x', $metadata: {} }),
      ),
    ).toEqual([]);
  });

  it('returns undefined for other errors and non-objects', () => {
    expect(cancellationReasons(new Error('x'))).toBeUndefined();
    expect(cancellationReasons('boom')).toBeUndefined();
    expect(cancellationReasons(null)).toBeUndefined();
  });
});

describe('conditionFailedAt', () => {
  const error = canceled('None', 'ConditionalCheckFailed');

  it('is true only at the index holding ConditionalCheckFailed', () => {
    expect(conditionFailedAt(error, 1)).toBe(true);
    expect(conditionFailedAt(error, 0)).toBe(false);
    expect(conditionFailedAt(error, 5)).toBe(false);
  });

  it('is false for other errors', () => {
    expect(conditionFailedAt(new Error('x'), 0)).toBe(false);
  });
});

describe('isConditionalCheckFailed', () => {
  it('matches ConditionalCheckFailedException only', () => {
    expect(
      isConditionalCheckFailed(
        new ConditionalCheckFailedException({ message: 'x', $metadata: {} }),
      ),
    ).toBe(true);
    expect(isConditionalCheckFailed(new Error('x'))).toBe(false);
    expect(isConditionalCheckFailed('x')).toBe(false);
    expect(isConditionalCheckFailed(undefined)).toBe(false);
  });
});

describe('requireTransaction', () => {
  it('returns the same DynamoTransaction instance', () => {
    const tx = new DynamoTransaction(client, TABLE);

    expect(requireTransaction(tx, 'os.execucao.solicitada')).toBe(tx);
  });

  it('throws when tx is not a DynamoTransaction', () => {
    const message =
      'os.execucao.solicitada exige a transação do IdempotentProcessor';

    expect(() =>
      requireTransaction(undefined, 'os.execucao.solicitada'),
    ).toThrow(message);
    expect(() => requireTransaction({}, 'os.execucao.solicitada')).toThrow(
      message,
    );
  });
});
