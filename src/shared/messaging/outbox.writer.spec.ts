import type { TransactionWriter } from '../dynamodb/transaction';
import type { DomainEvent } from './domain-event';
import { OutboxWriter } from './outbox.writer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const base: DomainEvent = {
  evento: 'execucao.iniciada',
  aggregateType: 'Execucao',
  aggregateId: 'os-1',
  payload: { inicio: 'x' },
  correlationId: 'corr-1',
  traceparent: '00-abc-def-01',
};

describe('OutboxWriter', () => {
  let writer: OutboxWriter;
  let put: jest.Mock;
  let tx: TransactionWriter;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-13T12:00:00.000Z') });
    writer = new OutboxWriter();
    put = jest.fn().mockReturnValue(0);
    tx = { put, update: jest.fn(), size: 0 };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an empty list without touching tx', () => {
    expect(writer.append(tx, [])).toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });

  it('writes the full pending item', () => {
    const ids = writer.append(tx, [base]);

    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(UUID);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toEqual({
      Item: {
        PK: `OUTBOX#${ids[0]}`,
        SK: 'OUTBOX',
        id: ids[0],
        evento: 'execucao.iniciada',
        aggregateType: 'Execucao',
        aggregateId: 'os-1',
        payload: { inicio: 'x', osId: 'os-1', id: 'os-1' },
        correlationId: 'corr-1',
        traceparent: '00-abc-def-01',
        OUTBOX_PK: 'PENDENTE',
        OUTBOX_SK: '2026-11-13T12:00:00.000Z',
        createdAt: '2026-11-13T12:00:00.000Z',
      },
    });
  });

  it('does not add a ConditionExpression', () => {
    writer.append(tx, [base]);

    expect(put.mock.calls[0][0]).not.toHaveProperty('ConditionExpression');
  });

  it('carries the correlationId of the event', () => {
    writer.append(tx, [{ ...base, correlationId: 'corr-from-message' }]);

    expect(put.mock.calls[0][0].Item.correlationId).toBe('corr-from-message');
  });

  it('omits traceparent when absent', () => {
    writer.append(tx, [{ ...base, traceparent: undefined }]);

    expect('traceparent' in put.mock.calls[0][0].Item).toBe(false);
  });

  it('forces osId/id to aggregateId', () => {
    writer.append(tx, [
      { ...base, payload: { osId: 'outro', id: 'x', motivo: 'm' } },
    ]);

    expect(put.mock.calls[0][0].Item.payload).toEqual({
      osId: 'os-1',
      id: 'os-1',
      motivo: 'm',
    });
  });

  it('normalizes payload to JSON', () => {
    writer.append(tx, [
      {
        ...base,
        payload: {
          quando: new Date('2026-01-02T03:04:05.000Z'),
          nada: undefined,
        },
      },
    ]);

    const payload = put.mock.calls[0][0].Item.payload as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      quando: '2026-01-02T03:04:05.000Z',
      osId: 'os-1',
      id: 'os-1',
    });
    expect('nada' in payload).toBe(false);
  });

  it('writes one item per event with distinct ids in input order', () => {
    const ids = writer.append(tx, [
      base,
      { ...base, evento: 'execucao.concluida' },
    ]);

    expect(put).toHaveBeenCalledTimes(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(put.mock.calls[0][0].Item.id).toBe(ids[0]);
    expect(put.mock.calls[1][0].Item.id).toBe(ids[1]);
    expect(put.mock.calls[1][0].Item.evento).toBe('execucao.concluida');
  });

  it('rejects a missing aggregateId before writing anything', () => {
    expect(() =>
      writer.append(tx, [base, { ...base, aggregateId: '' }]),
    ).toThrow('aggregateId (osId) ausente no evento execucao.iniciada');
    expect(put).not.toHaveBeenCalled();
  });
});
