import {
  INDEX_FILA,
  INDEX_OUTBOX,
  OUTBOX_PENDENTE,
  eventoKey,
  execucaoKey,
  filaKeys,
  msgKey,
  outboxKey,
  outboxPendingKeys,
} from './keys';

describe('dynamodb keys', () => {
  it('exposes index and status constants', () => {
    expect(INDEX_FILA).toBe('fila');
    expect(INDEX_OUTBOX).toBe('outbox');
    expect(OUTBOX_PENDENTE).toBe('PENDENTE');
  });

  it('builds execucao key', () => {
    expect(execucaoKey('os-1')).toEqual({ PK: 'OS#os-1', SK: 'META' });
  });

  it('builds fila keys', () => {
    expect(filaKeys('AGUARDANDO', '1', '2026-01-01T00:00:00.000Z')).toEqual({
      GSI1PK: 'FILA',
      GSI1SK: 'AGUARDANDO#1#2026-01-01T00:00:00.000Z',
    });
  });

  it('builds evento key', () => {
    expect(eventoKey('os-1', '2026-01-01T00:00:00.000Z', 'evt-9')).toEqual({
      PK: 'OS#os-1',
      SK: 'EVT#2026-01-01T00:00:00.000Z#evt-9',
    });
  });

  it('builds msg key', () => {
    expect(msgKey('evt-9')).toEqual({ PK: 'MSG#evt-9', SK: 'MSG' });
  });

  it('builds outbox key', () => {
    expect(outboxKey('ob-3')).toEqual({ PK: 'OUTBOX#ob-3', SK: 'OUTBOX' });
  });

  it('builds outbox pending keys', () => {
    expect(outboxPendingKeys('2026-01-01T00:00:00.000Z')).toEqual({
      OUTBOX_PK: 'PENDENTE',
      OUTBOX_SK: '2026-01-01T00:00:00.000Z',
    });
  });
});
