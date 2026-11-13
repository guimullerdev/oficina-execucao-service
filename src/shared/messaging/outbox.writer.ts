import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { outboxKey, outboxPendingKeys } from '../dynamodb/keys';
import type { TransactionWriter } from '../dynamodb/transaction';
import type { DomainEvent } from './domain-event';

/**
 * Stored OUTBOX item. MUST be a `type` alias (not `interface`) so it is
 * assignable to Record<string, NativeAttributeValue>.
 */
export type OutboxItem = {
  PK: string; // OUTBOX#<id>
  SK: string; // OUTBOX
  id: string; // uuid; published as attribute eventId
  evento: string;
  aggregateType: string;
  aggregateId: string; // = osId in this service
  payload: Record<string, unknown>;
  correlationId: string;
  traceparent?: string; // key absent when falsy
  OUTBOX_PK?: string; // 'PENDENTE' while pending (sparse GSI 'outbox')
  OUTBOX_SK?: string; // createdAt ISO
  createdAt: string;
  publicadoEm?: string; // set by the publisher
};

@Injectable()
export class OutboxWriter {
  /**
   * Adds one Put per event to tx. Synchronous (callers must not await it);
   * returns the outbox ids in input order.
   */
  append(tx: TransactionWriter, events: DomainEvent[]): string[] {
    if (events.length === 0) {
      return [];
    }

    for (const e of events) {
      if (!e.aggregateId) {
        throw new Error(`aggregateId (osId) ausente no evento ${e.evento}`);
      }
    }

    const createdAt = new Date().toISOString();

    return events.map((e) => {
      const id = randomUUID();
      // The JSON round trip turns Dates into ISO strings and drops undefined,
      // so what is stored equals what is published. Identity fields go last
      // so they win over the payload.
      const payload = {
        ...(JSON.parse(JSON.stringify(e.payload)) as Record<string, unknown>),
        osId: e.aggregateId,
        id: e.aggregateId,
      };

      const Item: OutboxItem = {
        ...outboxKey(id),
        ...outboxPendingKeys(createdAt),
        id,
        evento: e.evento,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload,
        correlationId: e.correlationId,
        ...(e.traceparent ? { traceparent: e.traceparent } : {}),
        createdAt,
      };

      tx.put({ Item });
      return id;
    });
  }
}
