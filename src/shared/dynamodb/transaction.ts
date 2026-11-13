import { randomUUID } from 'node:crypto';

import type { CancellationReason } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  type NativeAttributeValue,
  TransactWriteCommand,
  type TransactWriteItem,
  type TransactWritePut,
  type TransactWriteUpdate,
} from '@aws-sdk/lib-dynamodb';

/** DynamoDB TransactWriteItems limit. */
export const MAX_TRANSACT_ITEMS = 100;
export const CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailed';

type Attributes = Record<string, NativeAttributeValue>;

export type TransactPutParams = Omit<TransactWritePut, 'TableName' | 'Item'> & {
  Item: Attributes;
};
export type TransactUpdateParams = Omit<
  TransactWriteUpdate,
  'TableName' | 'Key'
> & { Key: Attributes };

/** What handlers / use cases may touch. Handlers MUST NOT commit. */
export interface TransactionWriter {
  readonly size: number;
  /** Adds a Put; returns its index in TransactItems. */
  put(params: TransactPutParams): number;
  /** Adds an Update; returns its index in TransactItems. */
  update(params: TransactUpdateParams): number;
}

export class DynamoTransaction implements TransactionWriter {
  private readonly items: TransactWriteItem[] = [];
  private readonly keys = new Set<string>();
  private committed = false;

  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  get size(): number {
    return this.items.length;
  }

  put(params: TransactPutParams): number {
    return this.add(params.Item, {
      Put: { ...params, TableName: this.tableName },
    });
  }

  update(params: TransactUpdateParams): number {
    return this.add(params.Key, {
      Update: { ...params, TableName: this.tableName },
    });
  }

  async commit(): Promise<void> {
    if (this.committed) {
      throw new Error('Transação DynamoDB já confirmada');
    }
    // A failed transaction is not reusable: create a new one.
    this.committed = true;

    if (this.items.length === 0) {
      return;
    }

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: this.items,
        ClientRequestToken: randomUUID(),
      }),
    );
  }

  private add(key: Attributes, item: TransactWriteItem): number {
    if (this.committed) {
      throw new Error('Transação DynamoDB já confirmada');
    }
    if (this.items.length >= MAX_TRANSACT_ITEMS) {
      throw new Error(`Transação DynamoDB excede ${MAX_TRANSACT_ITEMS} itens`);
    }
    const keyId = `${String(key.PK)}|${String(key.SK)}`;
    if (this.keys.has(keyId)) {
      throw new Error(`Item duplicado na transação: ${keyId}`);
    }
    this.keys.add(keyId);
    this.items.push(item);
    return this.items.length - 1;
  }
}

// Match on `name` rather than `instanceof` so it survives duplicated SDK copies.
function nameOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { name?: unknown }).name
    : undefined;
}

export function cancellationReasons(
  error: unknown,
): CancellationReason[] | undefined {
  if (nameOf(error) !== 'TransactionCanceledException') {
    return undefined;
  }
  return (
    (error as { CancellationReasons?: CancellationReason[] })
      .CancellationReasons ?? []
  );
}

export function conditionFailedAt(error: unknown, index: number): boolean {
  return cancellationReasons(error)?.[index]?.Code === CONDITIONAL_CHECK_FAILED;
}

/** Single-item operations (e.g. UpdateCommand). */
export function isConditionalCheckFailed(error: unknown): boolean {
  return nameOf(error) === 'ConditionalCheckFailedException';
}

export function requireTransaction(
  tx: unknown,
  evento: string,
): TransactionWriter {
  if (tx instanceof DynamoTransaction) {
    return tx;
  }
  throw new Error(`${evento} exige a transação do IdempotentProcessor`);
}
