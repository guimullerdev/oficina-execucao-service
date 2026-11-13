import { Execucao } from './execucao';
import { ExecucaoStatus } from './execucao-status';
import { byStatusPriorityThenOldest } from './execucao-ordering';

function makeExecucao(status: ExecucaoStatus, dataAbertura: Date): Execucao {
  return Execucao.fromPersistence({
    osId: 'os-test',
    status,
    prioridade: 1,
    dataAbertura,
    sagaId: 'saga-test',
    correlationId: 'corr-test',
  });
}

const d = (offset: number) => new Date(2024, 0, offset);

describe('Execucao listing — status priority ordering', () => {
  it('orders by priority: EM_EXECUCAO > RECEBIDA > FALHOU > FINALIZADA', () => {
    const list = [
      makeExecucao(ExecucaoStatus.FINALIZADA, d(1)),
      makeExecucao(ExecucaoStatus.FALHOU, d(1)),
      makeExecucao(ExecucaoStatus.RECEBIDA, d(1)),
      makeExecucao(ExecucaoStatus.EM_EXECUCAO, d(1)),
    ].sort(byStatusPriorityThenOldest);

    expect(list.map((e) => e.status)).toEqual([
      ExecucaoStatus.EM_EXECUCAO,
      ExecucaoStatus.RECEBIDA,
      ExecucaoStatus.FALHOU,
      ExecucaoStatus.FINALIZADA,
    ]);
  });

  it('within the same status, orders oldest first', () => {
    const list = [
      makeExecucao(ExecucaoStatus.RECEBIDA, d(3)),
      makeExecucao(ExecucaoStatus.RECEBIDA, d(1)),
      makeExecucao(ExecucaoStatus.RECEBIDA, d(2)),
    ].sort(byStatusPriorityThenOldest);

    expect(list.map((e) => e.dataAbertura)).toEqual([d(1), d(2), d(3)]);
  });

  it('applies both rules together correctly', () => {
    const list = [
      makeExecucao(ExecucaoStatus.RECEBIDA, d(5)),
      makeExecucao(ExecucaoStatus.EM_EXECUCAO, d(3)),
      makeExecucao(ExecucaoStatus.RECEBIDA, d(1)),
      makeExecucao(ExecucaoStatus.FINALIZADA, d(4)),
      makeExecucao(ExecucaoStatus.EM_EXECUCAO, d(2)),
      makeExecucao(ExecucaoStatus.FALHOU, d(6)),
    ].sort(byStatusPriorityThenOldest);

    expect(
      list.map((e) => ({ status: e.status, day: e.dataAbertura.getDate() })),
    ).toEqual([
      { status: ExecucaoStatus.EM_EXECUCAO, day: 2 },
      { status: ExecucaoStatus.EM_EXECUCAO, day: 3 },
      { status: ExecucaoStatus.RECEBIDA, day: 1 },
      { status: ExecucaoStatus.RECEBIDA, day: 5 },
      { status: ExecucaoStatus.FALHOU, day: 6 },
      { status: ExecucaoStatus.FINALIZADA, day: 4 },
    ]);
  });

  it('places terminal statuses (FALHOU, FINALIZADA) after active work', () => {
    const list = [
      makeExecucao(ExecucaoStatus.FINALIZADA, d(1)),
      makeExecucao(ExecucaoStatus.RECEBIDA, d(2)),
    ].sort(byStatusPriorityThenOldest);

    expect(list[0].status).toBe(ExecucaoStatus.RECEBIDA);
    expect(list[1].status).toBe(ExecucaoStatus.FINALIZADA);
  });
});
