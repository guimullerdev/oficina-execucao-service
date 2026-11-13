export const INDEX_FILA = 'fila';
export const INDEX_OUTBOX = 'outbox';
export const OUTBOX_PENDENTE = 'PENDENTE';

export function execucaoKey(osId: string): { PK: string; SK: string } {
  return { PK: `OS#${osId}`, SK: 'META' };
}

export function filaKeys(
  status: string,
  prioridade: string,
  dataAbertura: string,
): { GSI1PK: string; GSI1SK: string } {
  return { GSI1PK: 'FILA', GSI1SK: `${status}#${prioridade}#${dataAbertura}` };
}

export function eventoKey(
  osId: string,
  iso: string,
  id: string,
): { PK: string; SK: string } {
  return { PK: `OS#${osId}`, SK: `EVT#${iso}#${id}` };
}

export function msgKey(eventId: string): { PK: string; SK: string } {
  return { PK: `MSG#${eventId}`, SK: 'MSG' };
}

export function outboxKey(id: string): { PK: string; SK: string } {
  return { PK: `OUTBOX#${id}`, SK: 'OUTBOX' };
}

export function outboxPendingKeys(iso: string): {
  OUTBOX_PK: string;
  OUTBOX_SK: string;
} {
  return { OUTBOX_PK: OUTBOX_PENDENTE, OUTBOX_SK: iso };
}
