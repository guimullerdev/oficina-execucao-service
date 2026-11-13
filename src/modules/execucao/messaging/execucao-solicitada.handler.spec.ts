import { DynamoTransaction } from '../../../shared/dynamodb/transaction';
import { ExecucaoSolicitadaHandler } from './execucao-solicitada.handler';

describe('ExecucaoSolicitadaHandler', () => {
  const handler = new ExecucaoSolicitadaHandler();
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

  it('puts META (conditional) and EVT in the transaction', async () => {
    const tx = new DynamoTransaction({} as never, 'tbl');
    const put = jest.spyOn(tx, 'put');

    await handler.handle(message, tx);

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
    const evt = put.mock.calls[1][0];
    expect(evt.Item.SK).toMatch(/^EVT#/);
    expect(evt.Item.tipo).toBe('RECEBIDA');
  });

  it('omits correlationId when absent', async () => {
    const tx = new DynamoTransaction({} as never, 'tbl');
    const put = jest.spyOn(tx, 'put');
    await handler.handle({ ...message, correlationId: undefined }, tx);
    expect(put.mock.calls[0][0].Item).not.toHaveProperty('correlationId');
  });

  it('requires the processor transaction', async () => {
    expect(() => handler.handle(message)).toThrow(/exige a transação/);
  });
});
