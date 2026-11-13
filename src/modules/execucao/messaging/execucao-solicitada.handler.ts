import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  eventoKey,
  execucaoKey,
  filaKeys,
} from '../../../shared/dynamodb/keys';
import { requireTransaction } from '../../../shared/dynamodb/transaction';
import {
  IncomingMessage,
  MessageHandler,
} from '../../../shared/messaging/handlers/message-handler.interface';

export const EVENTO_EXECUCAO_SOLICITADA = 'os.execucao.solicitada';
export const STATUS_RECEBIDA = 'RECEBIDA';
/** Prioridade padrão das execuções recebidas (sem priorização por enquanto). */
export const PRIORIDADE_PADRAO = 0;
const PRIORIDADE_WIDTH = 3;

export type ExecucaoSolicitadaPayload = {
  id: string;
  sagaId: string;
  ordem: number;
  nome: string;
  causadoPor: string;
};

@Injectable()
export class ExecucaoSolicitadaHandler implements MessageHandler {
  readonly evento = EVENTO_EXECUCAO_SOLICITADA;

  handle(message: IncomingMessage, tx?: unknown): Promise<void> {
    const writer = requireTransaction(tx, this.evento);
    const payload = message.payload as ExecucaoSolicitadaPayload;
    const osId = payload.id;
    const now = new Date().toISOString();
    const prioridade = PRIORIDADE_PADRAO;

    writer.put({
      Item: {
        ...execucaoKey(osId),
        ...filaKeys(
          STATUS_RECEBIDA,
          String(prioridade).padStart(PRIORIDADE_WIDTH, '0'),
          now,
        ),
        osId,
        status: STATUS_RECEBIDA,
        prioridade,
        dataAbertura: now,
        sagaId: payload.sagaId,
        ordem: payload.ordem,
        nome: payload.nome,
        causadoPor: payload.causadoPor,
        ...(message.correlationId
          ? { correlationId: message.correlationId }
          : {}),
      },
      // Um comando reenviado com outro eventId não sobrescreve a execução.
      ConditionExpression: 'attribute_not_exists(PK)',
    });

    writer.put({
      Item: {
        ...eventoKey(osId, now, randomUUID()),
        tipo: STATUS_RECEBIDA,
        detalhe: `Execução solicitada (saga ${payload.sagaId}, ordem ${payload.ordem})`,
        criadoEm: now,
      },
    });
    return Promise.resolve();
  }
}
